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

---

## Addendum, 2026-08-28 — tooling fixed, ledger re-adjudicated, no verdict changes

**Done, nothing owed by you.** The five machinery defects batch 1 exposed are
fixed on `claude/cluster-lookahead` and mirrored here (`be8fa31`); the batch-1
data fold is backported byte-identically and **the divergence above is closed** —
the standing direction is restored, `lib/` and `bin/` remain byte-identical
between the branches and never forked. Batch 1 was then **re-adjudicated under
the fixed rules: 20 of 20 polarity-sensitive rows now score the way they were
recorded by hand, and NO flag changed status.** Every verdict in this note
stands exactly as written.

**Three things change what you run, all of them in your favour:**

1. **Do NOT hand-edit `n0-aa-null.json` — the instruction above is withdrawn.**
   The generator now derives the A/A null's cells from the union of what the
   batch schedules, so N0 already floors all five: `headline-mix-king`,
   `hazard-mix-king`, `null-snake6`, `snake5-queen`, `snake5-knight`. Editing
   the spec by hand would be discarded the next time it is generated.
2. **P7F is added** (`CENTAUR_UNIT_FATALITY`, 16 blocks, 144 games/arm). Its
   flag is `live-null`, which the generator used to treat as settled; the null
   is 16 blocks against the 58 its own dispersion needs, so it decided nothing.
3. **The batch is now 13 specs / 3,048 games**, up from 12 / 2,472 — N0 from 96
   to 240 games/arm, plus P7F's 288. Still cut from the bottom.

**P5R still runs FIRST**, and P7F is second. Re-fetch `specs/batch2/` before you
start; the README there carries the full delta.

---

## Addendum, 2026-08-28 — `arch/s2` moved: the cohort governor is a different treatment now

**Nothing owed by you today, and DO NOT REGENERATE BATCH 2.** Batch 2 is
committed and stands exactly as it is; batch 3 is the ledger's next turn and
this note is the arm proposal for it.

### What changed on the bot side

`origin/arch/s2` is now **`962884a`** (was `724d83f`). Two things landed
together, and the second is the reason the first had to:

1. **The admission predicate is re-keyed on OWN-TEAM slider possibility**, and
   an own-slider board now runs the **slider repair profile**
   (`TERRITORY_SLIDER_PROFILE`, the i2 repair you raced as `lobster-slider` in
   P3) instead of being demoted to a material-ish objective.

   | board | arch/s2 `724d83f`, flag on | arch/s2 `962884a`, flag on |
   |---|---|---|
   | no slider anywhere | territory | territory |
   | **ENEMY owns a slider** | **base** | **territory** |
   | **WE own a slider** | **base** | **territory-slider** |

   Why: E1 raced asymmetric rosters (which no cell in your vocabulary can
   currently express — see below) and found territory's advantage over material
   is **+0.58** with no slider anywhere, **+0.57 [+0.23, +0.88]** when only the
   ENEMY owns one, and **−0.03 / −0.05** when we own one. The own bit separates
   the two regimes; the any bit separates nothing. A contact-forced replication
   reproduces it at 150 ms and widens it at 1000 ms. E2 then ablated the bundle
   and found the slider deficit is `reach` ceasing to discriminate (+0.514
   no-slider vs +0.000 on the slider cell) rather than `room` doing damage — so
   the right response to an own slider is the repair, not a demotion.

   **The raw ownership split says the OPPOSITE of all this and must not be
   quoted.** A queen is 4 material and a pawn is 1, so a raw split mostly
   measures the roster: on the contact cell it reads +0.68 for owning the queen
   and −0.10 for owning no slider, i.e. as if territory NEEDED a slider. Only
   the roster-matched, null-corrected contrast is quotable. The unforced-death
   tables are inconclusive at every cell and support neither scope.

2. **`arch/s2` now also carries the whole integrated evaluator**
   (`claude/mid-turn-collision-logic-mkxurg` @ `66904d2`) — gainOrdering
   promoted into the shipped generator, the bound bank's evaluation memo,
   staging safety behind its flag, the tier window, **fix/o-p3's room
   renormalisation**, idea/i2's slider repair, and engine/fix5's re-vendored
   partial engine. It had to: `TERRITORY_SLIDER_PROFILE` did not exist on
   arch/s2's lineage at all, because arch/s2 branched from `5bffe81`, before
   integ/round-a landed i2.

   **So a batch-3 arm on `arch/s2` is no longer a one-flag contrast against
   batch 1's arch/s2 bundle.** Any cross-batch comparison of
   `CENTAUR_COHORT_POLICY` against batch 1's row is confounded by the merge.
   Score batch 3's cohort rows against **batch 3's own OFF arm**, built from
   the same tip, and treat batch 1's P6 row as belonging to a different bot.

Still **default OFF**. Promotion is a code change, not a default flip, and it
rides your batch — the deterministic probes on this branch raise it to
`probe-passed` and no further, per the P7 rule.

### Batch-3 candidate arm

**`CENTAUR_COHORT_POLICY=on` vs the variable omitted**, bot bundle built from
`arch/s2` @ `962884a`, seated as the `lobster-territory` seat with the standard
reference field. Five cells, in two groups.

**Group A — the P3 cells, which your vocabulary already has.** These test
whether the governor reproduces, by itself, the win you measured by racing the
profile directly.

| spec shape | cell | roster | why |
|---|---|---|---|
| `p17-cohort-own-slider` | `snake5-queen` | `snake5-queen` | **The falsifiable prediction.** Every team holds a queen, so every seat's own-slider bit is TRUE and the governor selects the repair on every turn. If the amendment works, this arm should reproduce P3's `lobster-slider` result on this cell — **+0.115 [+0.014, +0.216]** at 2000 ms — because it is running the same profile by a different route. A materially smaller effect means the governor is not selecting what we think it is; a materially larger one means something else moved. |
| | `snake5-pawn` | `snake5-pawn` | A piece board with NO slider on it. The own bit is false for every seat, so the governor must select plain territory and this cell must read **null**. P3 measured `lobster-slider` here at +0.0104 [−0.0720, +0.0929], so a non-null here is a governor defect and not a profile effect. |
| | `null-snake6` | `snake6` | The objective-choice null. With no piece on the board the governor selects territory, which is what an OFF arm runs, so the only difference is the governor's own measurement and stamp. It is **not** a bit-identity null the way it was for P3 — expect the measurement floor plus the governor's overhead, and read `worstWallMs` for the overhead rather than folding it into `score`. |

**Group B — the E1 asymmetric cells, and they need a generator change first.**
These are the half of the amendment that Group A structurally cannot test: a
symmetric roster makes "I own a slider" and "a slider exists" the same bit, so
no cell in the current vocabulary can distinguish the old predicate from the new
one. This is the same reason the 945-game corpus could not answer E1.

| spec shape | cell | rosters | why |
|---|---|---|---|
| `p18-cohort-asym-scope` | `e1-asym-qp` | red `queen`+5 snakes, blue `pawn`+5 snakes, green 6 snakes | **The scope test.** Seat rotation walks the territory seat through owner / non-owner / non-owner, so one cell yields both classes with board-level slider presence held constant. The `own=F` rotations are the ones the old predicate demoted and the new one does not. |
| | `e1c-asym-qp` | the same rosters at **size 15** | E1's contact-forced replication. Half its games end by elimination against one in eight on the 23-board, so it is the cell that would break the verdict if anything does. |

**What the generator needs** (small, and the harness already supports it): the
harness's `MatchConfig.roster` accepts **either** one shared roster **or**
`Record<teamId, roster>` (`harness/lib/config.ts`, `rosterFor`), but
`tools/learnloop/lib/cells.js`'s `ROSTERS` table only offers the shared form.
Adding a per-team entry there — and NOT re-cutting any existing cell name, so
the ledger's cell-keyed history keeps meaning what it says — is all that is
missing. E1 ran these rosters through `scratchpad/p2h` on `perf/p0`, so the
shapes are known-good; only the spec vocabulary is short.

**Budget.** E1's numbers are at 150 ms and its addendum's second wave at
1000 ms; your batches run at 2000 ms and P3's win is a 2000 ms measurement. Run
group B at **your 2000 ms convention** so it lays against group A and against
the ledger, and read the E1 numbers as directional at a different budget rather
than as a target. The one budget-gradient fact on record points the right way:
the `own=F` row grew from +0.53 at 150 ms to +0.75 at 1000 ms.

**Flag-value trap, specific to this flag.** `CENTAUR_COHORT_POLICY` does **not**
parse the `1|on|true` set the other CL flags use — it accepts exactly `on` or
`off` (case-insensitive, trimmed) and **logs a warning and keeps `off`** for
anything else. `"on"` is what batch 1 used and it is right. Set the OFF arm by
**omitting** the variable, and check `envAtRun` afterwards as usual.

**One warning that is now sharper, not weaker.** Do not read any cohort-policy
result on the bot repo's own acceptance corpus (`snakes11` / `mid11`). Twelve of
its thirteen boards demote on the thin-roster rule and the thirteenth owns a
slider, so an ON arm measured there contains **no cell in which the shipped
territory objective runs at all**. That corpus is a replay gate, not a sweep
corpus. Your cells are unaffected; this is stated so nobody substitutes one for
the other.

---

## Addendum, 2026-08-29 — P11's spec is corrected: repull `specs/batch2/` before batch 2

**One line, and it changes what you run:** every P11 contender now carries
`CENTAUR_CLUSTER_ENUM=on`, base included (`enum-on` / `enum-on+scout-observe` /
`enum-on+scout-advise`, where the spec said `off` / `scout-observe` /
`scout-advise`) — `CENTAUR_SCOUT` alone is a silent no-op because `scout.run`'s
only call site sits inside the cluster enumeration, so the old triple was three
identical builds; nothing else in the batch moved (still 12 specs / 2,760
games), and the ledger's `home.mirroredFrom.state` carries the full delta.
