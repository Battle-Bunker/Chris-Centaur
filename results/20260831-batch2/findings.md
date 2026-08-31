# Sim results: 20260831-batch2

Local simulation batch 2, run overnight on the owner's box, 2026-08-31,
**13h22m wall clock, 2,472 games, 11 paired sweeps, zero crashed cells**.

Every number here is a paired measurement read against **this batch's own
same-night A/A control**. Where a delta sits inside its control band it is
reported as unreadable, not as an effect.

## Words used in this report

- **contender** — one of the two versions being compared in a paired run.
- **board** — a map shape plus its unit roster, for example, `headline-mix-king` is a
  25x25 board with a king, queen, rook, knight and two snakes a side.
- **block** — one seed played through all three seat rotations; three games.
  Blocks, not games, are the unit everything is averaged over.
- **A/A control** — two byte-identical copies of the same version raced against
  each other. Whatever gap they show is pure noise, and that gap is the
  yardstick every real comparison is measured against.
- **floor** / **control band** — the size of that noise gap. A result smaller
  than the floor is not a small win; it is nothing this experiment can see.
- **sharePar** — the objective: what share of everything alive at the end a
  version owned, where 1.0 is an even split.
- **search layer** — the part of the bot that looks ahead before moving.
  Where this report said "search-layer version" it means the alternative
  board-representation the search runs on, built from `claude/cluster-lookahead`.
- The **P-codes** (`P7F`, `P9`, `P10`, `P11`, `P12`, `P13`, `P16`, `X9`, `N0`)
  are the experiment IDs from the batch plan; each is named where it is used.

---

## The Headline, And IT IS A Negative

**No placement effect in this batch clears its own board's A/A control band.**
Not one, on any board, for any of the seven treatments tested.

That is a real result, not a failure to find one. It is also exactly what
Methodology §3 predicts: placement resolves to roughly ±0.10 at 16 blocks, and
a smaller delta is not a small effect but no effect this design can see. What
*did* move — cleanly, repeatedly, and far outside the noise — is mechanism.
Eleven of the sweeps' cells carry mechanism separations whose intervals exclude
zero, several of them by one to two orders of magnitude.

**The one that would have been claimed under a looser test.** The fatality classifier's
`unit-fatality` on `null-snake6` gives sharePar **+0.1542 [+0.0249, +0.2835]**
against a floor of **±0.1173**. Its own interval excludes zero and its mean
exceeds the floor — but its interval overlaps the floor band heavily, so under
the stricter test (whole interval outside the band) it does not survive. It is
also on the **inert null roster**, which is the board that exists to show the
noise floor, and that experiment's actual question is about boards that field pieces. Reported here so
nobody rediscovers it and reads it as a win.

---

## 1. The Control, First

`Verdict: nullA vs nullB is a valid A/A null.` Two byte-identical builds,
240 games each, 16 blocks, all five boards this batch touches. Every interval
spans zero.

| board | `sharePar` floor | `score` floor | batch 1 `score` floor |
|---|---|---|---|
| `null-snake6` | ±0.1173 | ±0.0324 | ±0.032 |
| `snake5-knight` | ±0.1238 | ±0.0638 | — |
| `snake5-queen` | ±0.3175 | ±0.1179 | — |
| `hazard-mix-king` | ±0.7893 | ±0.1551 | — |
| `headline-mix-king` | ±0.7413 | ±0.1605 | ±0.0973 |

**Three boards have a measured floor for the first time.** `snake5-queen`,
`snake5-knight` and `hazard-mix-king` were previously being read against a
floor that did not exist — the defect that made five batch-1 ledger rows
change reading. They now have their own.

### Instrument Event: the headline board's floor widened 65%

`headline-mix-king` scores ±0.1605 against batch 1's ±0.0973. The N0 spec asks
that a wider band be flagged as an instrument event rather than shrugged off,
so: flagged.

**It is not the box.** `null-snake6` reproduces batch 1's floor to three
decimal places (±0.0324 vs ±0.032) under the same 10 workers per contender and
a load average of 21-24 on 24 cores. If saturation were widening bands, the
snake board would have widened too. It did not.

So the widening is specific to the mix-king boards, and it **independently
corroborates the open `Cell-Quality` item** — the finding that
`headline-mix-king` flips 26 of 48 placements between two builds of the same
commit. Both mix-king boards here carry `sharePar` floors near ±0.75-0.79,
which is enormous next to `null-snake6`'s ±0.12. **On present evidence
`headline-mix-king` cannot resolve a placement effect of any plausible size at
16 blocks**, and every mix-king placement row in this batch is a null by
construction. If a question can be asked on another board, it should be.

---

## 2. Engagement IS Shown, Not Assumed

Batch 1 could not write a live status for anything, because its bundles carried
no mechanism rows — "engagement not shown moves nothing". **These bundles carry
them.** Every treatment is verified from the resolved config on the actual game
rows, per seat:

```
default contender:        lobster-territory -> unitFatality=false   x142
unit-fatality contender:  lobster-territory -> unitFatality=true    x144
```

So **a null in this batch means "it ran and did not help", not "we cannot tell
whether it ran"**. That distinction is the whole reason the batch is worth
mining.

**A trap I had to steer around.** `claude/mid-turn-collision-logic-mkxurg` is
Pre-teardown and carries no `bot-config` module, so it ignores a bot config
entirely and plays the shipped bot under a treatment's name — the silent A/A
that voided P5. I checked for `src/lobster/bot-config.ts` on each ref before
building. **Every config-selected contender was therefore built from
`b2-perf`.** `b2-integrated` appears only in the budget ladder, where the two
contenders are whole bundles and no config is passed.

---

## 3. Verdict Lines

One sentence per question, each with its number, its interval, and the floor it
was read against. **No placement claim survives; the mechanism readings are
where the information is.**

### The fatality classifier (`P7F`), on piece boards, with the failed seed off
**Verdict: null on placement, and the mechanism points the wrong way on the
board the question was about.** On `headline-mix-king`, sharePar
−0.4588 [−0.8861, −0.0315] against a floor of ±0.7413 — unreadable. But the
mechanism on that same board is adverse and its intervals exclude zero:
`finalMaterial` **−6.375 [−11.48, −1.274]** and `survived`
**−0.1458 [−0.2904, −0.0013]**. The classifier is not buying the fatal-staging
reduction it was promoted to buy here; it is costing material and survival.
`deathsTeammate` moved −0.1042 in the hoped-for direction but its interval
includes zero. Not promotable on this evidence.

### P12 — edge EV's staged-eat gain
**Verdict: a clean null, and now a live one.** sharePar −0.1769 / −0.1262 /
+0.0460 on `headline-mix-king` / `snake5-queen` / `null-snake6`, against floors
of ±0.7413 / ±0.3175 / ±0.1173. Nothing outside any band; no mechanism row
except `clusterEnumMs` moving. The 84→81 shortfall does not resolve either way
at this power, but the feature demonstrably ran.

### P9 — the sampled cap on piece boards at 2000 ms
**Verdict: the textbook "mechanism moves, placement does not".** Placement null
everywhere (−0.1256 / +0.0988 / −0.0138 against ±0.7413 / ±0.3175 / ±0.1173).
The mechanism separates hard:
- `ceilingDecided` **−565.3 [−963.8, −166.8]** on `null-snake6` and
  **−2852 [−4854, −850.3]** on `snake5-queen`.
- `selectionFar` goes from **absent in the control** to 3,026 / 261 / 51,998 —
  the far-priced options are unambiguously being selected.
- Cost side, and it is not free: on `snake5-queen` `worstWallMs`
  **+14.31 [+5.36, +23.26]** and `overrunRate` **+0.0014 [+0.0003, +0.0025]**.

It does exactly what it claims, it costs a little deadline safety, and it does
not convert either into placement at 16 blocks.

### P10 — the territory refiner at equal wall clock
**Verdict: null on placement, and the safety question came back clean.** The
spec asked whether a tighter floor pays for a third more territory time *at
equal wall clock*; the wall clock genuinely is equal (`worstWallMs` −0.1 /
+5.5 / +5.2 ms, `decisions` unchanged), so it is not buying time from anywhere.
It engages heavily — `refineMovedLo` 1,251 / 962 / 135,002 — and
**`refineInverted` is 0 on every board**: it never inverted a floor. Placement
−0.0639 / −0.3371 / −0.0795 against ±0.7413 / ±0.7893 / ±0.1173, all unreadable.

### P11 — run twice, in two different shapes, and the second one is the merge decision

**`sim/worker-kit` moved twice while this batch was running.** My checkout was
`cee34dd`; the tip is now `6ffb5aa`, and the 20260830 commit respecified P11
from a config pair into a branch-versus-branch pair. I ran the shape in my
checkout, then rebuilt nothing and ran the respecified shape too, because both
bundles already existed and the box was free. Same boards, same seeds, same
`sweepId`; the two readings sit side by side under different contender names.

#### The branch-versus-branch run (`P11a` here, the respecified experiment)

`baseline` = `mid-turn-collision-logic-mkxurg` @ `66904d2`;
`search-arch` = `cluster-lookahead` @ `b68ce98`. Both shipped defaults, **no bot
config on either side**. 144 games paired, 0 dropped.

**The engagement gate passes.** This is what the spec says a 16-block run is
actually for, and it is a real pass/fail at any size:

| board | `scoutPlies` | `scoutThreads` | `clusterJoints` |
|---|---|---|---|
| `headline-mix-king` | 136,806 | 147,965 | 14,592,634 |
| `hazard-mix-king` | 137,647 | 142,832 | 15,059,929 |
| `null-snake6` | 101,137 | 131,287 | 388,220 |

Non-zero on both piece-bearing boards, so this is **not** a refusal. The
`baseline` contender emits no mechanism block at all, which is correct — the
deep layer is not in that build, so it is engagement-verified by construction.

**The placement reading, and it may not decide the merge:**

| board | `sharePar` | half-width | control floor |
|---|---|---|---|
| `headline-mix-king` | −0.3945 [−0.9507, +0.1617] | **±0.5562** | ±0.7413 |
| `hazard-mix-king` | −0.6343 [−1.2607, −0.0080] | **±0.6263** | ±0.7893 |
| `null-snake6` | −0.0684 [−0.2355, +0.0987] | **±0.1671** | ±0.1173 |

**Too few games to settle the merge.** The spec's own measured sizing says
this pair needs about **73 blocks per board** to resolve to ±0.10; it ships at
16, and the observed half-widths above (±0.56, ±0.63) confirm the prediction of
roughly ±0.21-plus at this size. **The merge may not be decided from this run in
either direction.** Every delta here also sits inside its board's control band.

Said plainly, because the coordination note says this is the most expensive
mistake available in this batch: **this is not evidence the branch does not
help.** An effect of +0.2 sharePar sits comfortably inside these intervals. The
signs are negative on all three boards, which is worth someone's attention and
is worth nobody's conclusion.

What this run does establish: **the branch runs, it decides differently, and it
is fully engaged on the owner's board.** That is the gate, and it is the thing
16 blocks buys.

#### The depth-only run (`P11b` here, the shape I ran first)

`default` against `depthless` (`bot={"depth":{"plyCap":0}}`), same bundle, same
evaluator, same bounds, differing only in how far the search may look. The
respecified spec keeps this pair as **the follow-up** that says which part of
the branch did the work — so it is not wasted, it is early.

Placement null on all three boards: −0.0877 / +0.3734 / +0.0418 on
`headline-mix-king` / `hazard-mix-king` / `null-snake6`, against ±0.7413 /
±0.7893 / ±0.1173.

The mechanism separations are the largest in the batch, and they price the depth
ration precisely:
- `clusterEnumMs` **−31,940 / −29,640 / −2,364** — depth is a very large share
  of enumeration time.
- `scoutThreads` **−1,592 / −1,566 / −1,400**; `scoutPlies` −1,481 / −1,492 /
  −1,256 — the ration is genuinely spent to zero.
- On `hazard-mix-king`, **`depthless` survives more**: `finalUnits`
  **+0.9583 [+0.1107, +1.806]**, `survived` **+0.2083 [+0.0512, +0.3655]**,
  `deathsSelf` **−0.0833 [−0.1628, −0.0039]**.
- On `null-snake6`, `depthless` has a *lower* share of decisions past the
  deadline, **−0.0031 [−0.0055, −0.0007]**.

Read together with the branch run: the branch is engaged and unresolved at this size, and
the depth ration inside it costs a large amount of enumeration time while, on
the hazard board, the version that spends nothing on it came out ahead on three
survival mechanisms at once. That is a reason to buy the 73 blocks, not a reason
to decide anything now.

### P13 — the worker pool at 2000 ms on 24 cores
**Verdict: the pool did not produce extra throughput, let alone convert it.**
`decisions` +3.5 [−9.9, +17.0] and −1.5 [−5.1, +2.2]; `worstWallMs` −4.3 and
−0.7 ms; `overrunRate` 0 and 0.0024 vs 0.0021. Placement +0.1939 / −0.1200
against ±0.7413 / ±0.1173, unreadable.

The informative part is the *absence* of a throughput delta. At a 2000 ms
budget the single-threaded search already uses what it can, so the extra
threads have nothing to do. This is a cleaner negative than "it helped but not
enough", and it is a deployment question answered by benchmarks rather than a
strategy question.

**Run condition, stated because it differs from every other cell:** P13 ran at
**4 workers per contender, not 10**. The `workers-auto` contender spawns a
decision pool per game; at 10 the two contenders would have been competing for
24 cores asymmetrically, and unequal service between contenders is the exact
failure that got an entire measurement retracted from this program once before. The cost is that P13's
absolute throughput is not comparable to the other sweeps'. The paired
comparison inside P13 is unaffected — both contenders ran at 4.

### X9 — the falsifiability slice (4 blocks, mechanism-first, placement not read)
**Verdict: the promoted staging default is doing its job, and one honest
counter-signal.** With `stagingSafety=off`, `deathsSelf` rises
**+0.5 [+0.1938, +0.8062]** per game on `headline-mix-king` — the guard is
demonstrably preventing self-kills, which is the falsifiable claim the slice
exists to keep testable.

The counter-signal, reported because the slice is worthless if only confirming
results are carried: on `snake5-queen`, `staging-off` shows **fewer**
body-block deaths, `deathsBodyBlock` **−1.333 [−2.302, −0.3651]`, alongside
`ceilingDecided` −4,055 and `clusterEnumMs` −4,622. The guard is not free on
that board. At 4 blocks this is a pointer for a future cell, not a finding.

### P16 — the budget ladder, and the sharpest result in the batch
**Verdict: the ladder did not find where speed becomes strength. It found that
the search-layer version is not reliably anytime-safe below about 1000 ms.**

Placement is null at all three rungs (+0.3595 / −0.0313 / −0.4499 on
`headline-mix-king` against ±0.7413). The deadline behaviour is not null, and it
forms a clean monotonic curve. `integrated` overruns **zero** at every rung:

| rung | board | `worstWallMs` delta | share of decisions past the deadline |
|---|---|---|---|
| **500 ms** | `headline-mix-king` | **+314.8 [+151.8, +477.7]** | **0.2176 [+0.0912, +0.3440]** |
| **1000 ms** | `headline-mix-king` | **+67.5 [+24.9, +110.2]** | **0.0235 [+0.0014, +0.0456]** |
| **2000 ms** | `headline-mix-king` | +19.5 [−1.3, +40.4] | 0.0026 [−0.0015, +0.0067] |
| 500 ms | `null-snake6` | +13.5 [+1.2, +25.9] | ~0 |
| 1000 ms | `null-snake6` | +16.7 [+7.7, +25.6] | 0.0028 [−0.0005, +0.0061] |
| **2000 ms** | `null-snake6` | **+37.7 [+19.0, +56.3]** | **0.0063 [+0.0026, +0.0100]** |

At a 500 ms budget the search-layer version's worst decision takes **765 ms — 53% over
budget — and 21.8% of its decisions miss the deadline**, where the baseline
misses none. By 1000 ms that is 2.35%, and on the piece board it is
indistinguishable from zero at 2000 ms.

**This is very likely why nobody saw it before.** Batch 1's P1 measured this
this search layer only at 2000 ms and reported a clean "speed, not strength". The
breach only emerges as the budget tightens.

Two things that complicate the simple story, both carried rather than smoothed:
- **On `null-snake6` the overrun does Not vanish at 2000 ms** — it is
  significant there (0.0063) and largest there. So this is not purely a
  small-budget effect; the snake board's behaviour runs the other way.
- **At 2000 ms on `headline-mix-king` the search-layer version makes fewer decisions**,
  `decisions` **−20.5 [−37.7, −3.3]** and `turns` **−19.4 [−35.9, −2.9]**. A
  "search-layer version" producing 20 fewer decisions per game at the headline budget
  is worth an explanation before it is deployed on latency grounds.

**Caveat, and it matters for the absolute numbers.** The box ran 20 concurrent
games at load 21-24 of 24 cores, and a 500 ms budget is far more sensitive to
scheduler delay than 2000 ms. The **difference** is sound — paired, same seeds,
same boards, same load, and the baseline overran zero under exactly those
conditions. The **absolute** overrun rate would likely be lower on an idle box.
Anyone acting on the 21.8% figure should re-measure it quiet; anyone acting on
"this version misses deadlines and the baseline does not" can act now.

---

## 4. Integrity, Honestly

- **Pairing was exact everywhere. 0 games dropped in all 10 treatment sweeps**
  (144/144 ×5, 96/96, 48/48 ×3, 36/36). `aggregate.js` intersects game IDs
  across contenders; it dropped none.
- **Decision errors: 3, not 0.** In 2,472 games across ~198,000 decisions —
  a rate of about 1.5e-5. One in `n0-aa-null/nullA`, one in
  `p9-sampled_cap/default`, one in `p9-sampled_cap/sampled-cap`, all on
  `lobster-territory`. The previous batch's summaries said zero when the truth
  was four; this is the real number, carried in the summary as requested.
- **Illegal moves: 0.**
- **Worst overrun rate in the batch: 0.2176**, `p16-budget-500` on
  `headline-mix-king`. See the caveat above.
- **`plansEvaluated` and `boundsInversions` are Retired** and carry no verdict
  here. The tool now labels them `_RETIRED`; they moved substantially in several
  cells and are ignored.
- **Cap-terminal rates.** Many snake cells end 85-100% on the turn cap and are
  therefore measuring a stall rather than play — `batch-manifest.js` flags each
  one. This is a known limitation of the 120-turn cap at this board size, and it
  is the reason the coordinator suggested a raised-cap variant under a distinct
  cell name. Not run this batch; noted for batch 3.

## 5. What Was Not Run, And Why

- **the joint enumeration experiment (`P8/P9-joint`)** — Withdrawn by the 20260830 teardown, not by a result.
  Neither contender is buildable: the cluster enumeration has no off setting in
  any configuration of the shipped engine, and the joint partner's code was
  deleted. Spec file pruned by the generator.
- **the WebAssembly rerun (`P5R`)** — eliminated by owner ruling; the layer and its switch are gone.
- **the tier-truth rerun (`P4R`)** — closed by decision.
- **the admission-governor rerun (`P6R`)** — not scheduled. **Note: the blocker Handoff describes has
  Cleared.** `arch/s2` IS now published (`962884a`), along with a new `arch/s3`.
  Handoff §3 says to re-check this every batch, so: it is there, and P6 is
  buildable whenever it is wanted. P6R stays unscheduled for the different
  reason P-List gives — its admission counters want folding into the CL7
  mechanism report first.
- **X9's other two slices.** The slice comment asks for three opposite-branch
  slices but P-List budgets X9 as a single 36-game pair. I ran the
  staging-safety slice. The other two:
  - **the gain-ordering slice (`P15-slice`)** is **no longer expressible**.
    `gainOrdering` is not a field `botConfigFromJson` accepts, and the flag that
    used to select it was deleted in the teardown. There is no configuration of
    the shipped engine in which gain ordering does not run. This is a real gap
    in the falsifiability slice: **a promoted default that can no longer be falsified.**
  - **the slider-profile slice (`P3-slice`)** is expressible via the `evaluator`
    contender seam plus `--subject-map`, but it is a different selection
    mechanism from the other two and did not fit the single scheduled pair.
    Deferred with its reason rather than dropped.

## 6. Tooling Problems Found (no bot source was modified)

Two defects in `aggregate.js` that a future batch will hit again. **I did not
patch the tool** — I worked around both and am reporting them, since a silent
patch would make this batch's numbers incomparable with others.

### A. It picks the Wrong Subject Seat by default, and the error inverts signs
`aggregate.js` chose `lobster-material` as the subject. **The treatment lands
only on `lobster-territory`**, verified per seat:

```
unit-fatality contender:  lobster-territory -> unitFatality=True   x144
                          lobster-material  -> default (False)     x144
```

So the default aggregation measured a bot that was **identical in both
contenders**. Because these boards are close to zero-sum, the untreated seat
reported **+0.4588** on `headline-mix-king` where the treated bot actually took
**−0.4588** — same magnitude, opposite sign. Every table in this batch was
produced with **`--subject lobster-territory` passed explicitly.**

This is precisely the failure the 20260829 addendum says the cloud ingest was
pinned to fix ("it now refuses to guess"). **The local tool still guesses.** It
should refuse too.

### B. It crashes when the batch contains a board the base contender never ran
`TypeError: Cannot read properties of undefined (reading 'get')` at
`aggregate.js:531` — `byArm.get(baseName)` is undefined for any cell the base
contender is absent from. **N0 creates this condition by design**, since it now
floors every board in the batch and no treatment runs on all five. Workaround:
each sweep is aggregated through a symlink view containing only its own two
contenders (`tools/simworker-local/analyze-sweep.sh`, committed here).

### C. A documentation discrepancy
Handoff §3 says a bot config is "merged into **every** lobster contender".
Measured behaviour is that it merges into the **first** one only —
`lobster-territory` gets it, `lobster-material` does not. The observed behaviour
is arguably the better experiment, and it is what all these numbers reflect;
the doc should be corrected to match, because the difference is exactly what
makes the subject-seat bug above dangerous.

---

## 7. Host And Conditions

- `Desktop-6DUTJPI`, Ubuntu 22.04 running under the Windows Subsystem for
  Linux; **24 cores, 31 gigabytes of memory**; Node v22.23.2.
- **13h22m**, 2026-08-31 00:11 → 13:33 (+10:00). ~184 games/hour.
- **10 workers per contender**, both launched simultaneously, **one pair at a
  time** — matching batch 1 exactly so the control bands stay comparable.
  P13 at 4, documented above.
- **Load average 21-24 of 24** for the 2000 ms sweeps; ~9 during P13.
- Nothing else ran on the box. Sleep and hibernate disabled for the duration.
- **No sweep was resumed.** No cell crashed. All 11 sweeps exited `rc=0`.
- **81.4 MB in 2,593 files (2,472 replays)** — under the ~200 MB cap, so
  **nothing was pruned**. Every replay is present and the batch is fully
  re-minable at the turn level.

## 8. Builds — the SHAs actually built

| bundle | ref | SHA |
|---|---|---|
| `b2-perf` | `origin/claude/cluster-lookahead` | `b68ce98d54f1dbc8db4a453e2af193f7a92ef9fa` |
| `b2-integrated` | `origin/claude/mid-turn-collision-logic-mkxurg` | `66904d256103a1d3f32d060fe742e98b092d33b6` |

Harness commit `cee34dd97a49d4ebe6856d4d7ad4079edb849a87`. Both builds reported
the 6 expected pre-existing tsc errors in the drizzle route files with all
required artifacts present. `b2-perf` differs from the SHA in Handoff §3
(`8059b86`); per Handoff §10, the built SHA is the authority.

## 9. For The Next Batch

1. **Stop asking placement questions on `headline-mix-king` at 16 blocks.** Its
   `sharePar` floor is ±0.74. Two batches now agree it cannot resolve anything.
   Either quadruple the blocks there or move the question to `null-snake6`
   (±0.12) or `snake5-knight` (±0.12).
2. **P11 deserves a rerun with power.** The depth ration's cost is now measured
   and large, and `depthless` led on three survival mechanisms at once on
   `hazard-mix-king`. That is the shape of a question worth resolving properly
   before the pending decision is taken.
3. **The P16 deadline breach wants a quiet box** to separate the real overrun
   from scheduler noise, and an explanation for the −20.5 decisions at 2000 ms.
4. **`gainOrdering` can no longer be falsified.** A promoted default with no
   off switch is exactly the one-way door the exploration slice exists to prevent.
   That needs a config field, or the slice is fiction.
5. **Raised-cap variants.** Snake boards end 85-100% on the turn cap. Under a
   distinct cell name, per the coordinator's instruction.
