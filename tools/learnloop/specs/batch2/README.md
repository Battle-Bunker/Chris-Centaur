# Batch 2 — the proposed P-list

**Generated** by `node tools/learnloop/bin/make-promotion-batch.js` from
`tools/learnloop/promotion-ledger.json`. Regenerate rather than hand-edit; the
`_comment` block in each spec carries the question, the arms, the metrics it
reads out, and the design note that says why the arms are shaped that way.

`P-LIST.json` is the machine-readable form of the table below.

## 20260830, later still — THE BATCH IS UNDERSIZED FOR TWO OF ITS QUESTIONS, AND IT IS SHIPPING ANYWAY

A sandbox program ran 660 live games on 20260830 and measured two things this
batch had been guessing. Both are now written into the ledger as `POWER` blocks
and `REQUIRES` lines, and both are reproduced in every spec they affect. **No
spec was resized, no status moved, no measurement row was added or edited, and
the batch is still 11 specs / 2,472 games.** Here is the trade, stated plainly,
because it is a trade and not an oversight.

**1. P11 needs 73 blocks per cell and is emitted at 16.** The sandbox ran this
exact pair — baseline `66904d2` against search-arch `c74f0a1`, both shipped
defaults — and got sharePar −0.01 [−0.31, +0.29] at 8 blocks. The arm was fully
engaged (800 scout threads, 370 scout plies, 2,873 cluster joints per game), so
this is *engaged and unresolved*, not *engaged and did not help*. Cross-bundle
paired spread was ±0.303 against an A/A floor of ±0.10 — three times the floor.
Half-width scales as 1/√blocks, so **8 × (0.303/0.10)² = 73 blocks per cell**,
219 games per arm per cell, **1,314 games for the spec**.

**2. Piece-bearing cells may not floor at 16 blocks.** An A/A null on a
piece-bearing potions-ON hazard cell — two IDENTICAL bundles, identical configs,
identical seeds — returned **+0.271 [0.037, 0.506]** at 8 blocks. It excludes
zero. A cell whose own null excludes zero has no floor, and a delta with no floor
is UNREADABLE, not null. All-snake cells at the same size floored cleanly at
±0.10. Extrapolating the widest measured piece half-width, ±0.234 at 8 blocks,
a ±0.10 floor needs **8 × (0.234/0.10)² = 44 blocks per piece cell** — and the
crossover has never actually been measured, which is batch 3's rank-2 item.

**Why neither was applied.** Because block counts do not move alone. The
generator enforces that **the mandatory A/A null is sized like the largest
treatment** — a null narrower than the treatment understates the floor, in the
direction that makes a treatment look significant when it is not — so raising
one spec raises N0 with it, and N0 floors five cells. The prices, all four
measured by running the generator rather than estimated:

| batch | games | nights on the 24-core box | note |
|---|---|---|---|
| **as it ships: 16 blocks throughout** | **2,472** | ~1.4 | what this directory contains |
| P11 → 73, null left at 16 | 3,498 | ~1.9 | **REFUSED by the generator** — `the A/A null is 16 blocks against a 73-block treatment` |
| P11 → 73, null follows to 73 | 5,208 | ~2.9 | N0 alone becomes 2,190 games, 42% of the batch |
| + piece specs → 44 blocks | 7,560 | ~4.1 | the full sizing correction |

(Batch 1 ran 1,824 games in one overnight; the nights column is that rate.)

**So the batch ships at 16 blocks with its limits written on it.** What that
buys and what it does not:

- **P11's engagement gate is a real pass/fail at any block count**, and it is the
  most valuable thing 16 blocks buys: `deepestPlies > 0` and `deepBranches > 0`
  on the `search-arch` arm, on at least the piece cells. Zero there is a broken
  arm and is reported as a REFUSAL, not as a null.
- **The mechanism rows are readable at 16 blocks** — they are per-decision
  counts, not per-game outcomes, and most of these experiments were designed to
  read them.
- **THE MERGE MAY NOT BE DECIDED ON A 16-BLOCK P11, IN EITHER DIRECTION.** The
  expected half-width there is about ±0.21 sharePar, so an effect of +0.2 would
  sit inside the interval. A 16-block null is not evidence the branch does not
  help, and writing it up as one would be the most expensive error available.
  Quote the interval with its half-width and label it UNDERPOWERED.
- **Piece-cell deltas are quoted only against N0's floor on that same cell, same
  bundle, same block count.** If that floor does not contain zero, the cell
  reports UNREADABLE and no verdict comes out of it. Do not borrow the snake
  cell's floor for a piece cell, and do not borrow one bundle's floor for the
  other: the same cell floored ±0.120 on one bundle and ±0.234 on the other in
  one night.

**If there is room for more than 2,472 games, spend it on ONE cell of P11 at 73
blocks rather than on breadth.** One cell that can answer the question beats
three that cannot — and N0 must be raised with it, which is what makes it
expensive. That decision is the owner's, and it is the reason this section
exists rather than a resized directory.

## 20260830, later — P11 IS NOW BRANCH-VERSUS-BRANCH, AND IT IS A MERGE DECISION

Owner ruling of the same day (`docs/BRANCHING.md` on `claude/cluster-lookahead`
is the binding policy). **Unvalidated architecture does not accumulate on one
branch behind config defaults.** Two lanes only: strategy candidates at the
decision joints are in-tree collection members, selectable by config — adding
one is a normal commit; everything else about the architecture is built on a
feature branch, validated by benchmarks plus long-running paired batches, and
then **merged**.

So the branches are declared for what they are:

| branch | role |
|---|---|
| `claude/mid-turn-collision-logic-mkxurg` | **the validated baseline**, and the primary branch |
| `claude/cluster-lookahead` | **the search-architecture feature branch** — depth, the entry registry, the per-branch belief; the deep layer and the cluster enumeration always-built |

**P11 is respecified as the merge decision for that branch.** It was `default`
against `depthless` = `bot={"depth":{"plyCap":0}}`, one bundle and one config
field. It is now two bundles from two refs, both running their shipped defaults:

```
--arm 'baseline=<bundle-baseline>'          origin/claude/mid-turn-collision-logic-mkxurg
--arm 'search-arch=<bundle-search-arch>'    origin/claude/cluster-lookahead
```

Every generated spec that races branches now prints a **BUNDLES** block with the
exact `build-bot.sh` lines beside its `--arm` lines, because the one thing an
operator cannot reconstruct from prose is which ref an arm was built from.

**This dissolves the pending owner decision.** The question — does the default
bot keep carrying two never-raced features, or do they become config fields
defaulting off? — had two sides only while the architecture lived on the branch
that ships. It does not: the branch is a feature branch, and it merges on this
evidence or it does not. Both `CENTAUR_SCOUT`'s and `CENTAUR_CLUSTER_ENUM`'s open
findings are marked resolved-by-ruling in the ledger, and **neither status
moved** — `probe-passed` is still what the evidence says.

**The cost, stated plainly.** Two branch tips differ by everything that landed on
either since they forked, so a P11 delta attributes to *the branch* and to
nothing finer. That is the right instrument for a merge decision and the wrong
one for a mechanism claim. The one-variable depth pair (`plyCap: 0` on the
feature bundle alone) is still available and is the follow-up if the branch arm
reads positive and somebody wants to know which part of it did the work.

**No bot config on either P11 arm, deliberately.** The baseline bundle predates
the 20260829 teardown and has no `src/lobster/bot-config` module;
`checkContenders` would refuse a spec that declared a config against it — which
is correct, since such a bundle would ignore the config and play its shipped bot
under the arm's name. With no config declared, that check never fires.

**Engagement is read on the `search-arch` arm only**, from
`belief.deepestPlies` / `deepBranches`. The baseline arm is engagement-verified
by construction: the deep layer is not in that build, so there is no counter and
no silent-A/A risk on that side.

**THE A/A NULL PAIRS LIKE WITH LIKE, AND IT IS TWO SEARCH-ARCHITECTURE BUILDS.**
`verify-null.js` asserts an identical bundle SHA in both arms, so a null is one
bundle seated twice and a cross-branch batch has to choose which. The kit's
convention is the bundle the batch's arms *share*: batch 1 floored on
`integrated` @ `66904d2` because that build was the base arm of P1, P2 and P3 —
and then read P1, which was itself `integrated` against `perf-substrate` across
two branches, against that floor. Batch 2's shared bundle is the
search-architecture tip: base arm of P7F, P9, P10, P12, P13, X9 and all three
budget rungs, and one of P11's two arms. **P11's baseline arm therefore has no
floor of its own**, which is the same asymmetry batch 1 accepted in the other
direction; the null spec says so in its own text, and a second null pair on the
baseline bundle is the cheapest box time available if anyone wants it tested.

**Nothing else about the batch changes.** Still 11 specs / 2,472 games, same
cells, same seeds, same five floored boards. No status moved, no measurement row
was added or edited, no verdict changed.

---

## 20260830 — THE ARMS ARE CONFIGS NOW, AND P8/P9-JOINT IS WITHDRAWN

The search-layer teardown landed on `claude/cluster-lookahead` with the depth
work. `CENTAUR_CLUSTER_ENUM` and `CENTAUR_SCOUT` were **deleted** — not moved
to config — and `CENTAUR_EDGE_EV`, `CENTAUR_SAMPLED_CAP` and
`CENTAUR_MULTISTART_SEED` became `BotConfig` fields defaulting off. Four specs
in this batch named arms that no longer exist, so **four specs were
respecified through the generator and one was withdrawn.** No status moved and
no measurement row was touched.

| spec | was | is |
|---|---|---|
| **P8/P9-joint** | `off` / `enum-on` / `enum-on+seed-graded` | **WITHDRAWN.** Both halves unbuildable — see below |
| **P11** | `enum-on` / `+scout-observe` / `+scout-advise` | **superseded the same day** — see the branch-versus-branch section above; the intermediate shape was `default` / `depthless` = `bot={"depth":{"plyCap":0}}` |
| **P9** | `off` / `sampledcap-on` / `+enum-on` | `default` / `sampled-cap` = `bot={"sampledCap":true}` |
| **P10** | `enum-on` / `enum-on+refine-on` | `default` / `refiner` = `bot={"territoryRefine":true}` |
| **P12** | `off` / `edgeev-on` | `default` / `edge-ev` = `bot={"candidates":{"edgeEv":true}}` |
| **P7F** | `off` / `fatality-on` | `default` / `unit-fatality` (arm NAMES only; the question is unchanged) |

**Why P8/P9-joint is withdrawn and not translated.** There is no faithful
translation, because there is no question left. The cluster enumeration is now
always-built machinery with no off switch in any configuration of the shipped
engine, so an on-vs-off pair cannot be built from two current bundles at all;
and the joint arm's partner, `CENTAUR_CLUSTER_SEED`'s graded seed, was deleted
in the same teardown. The row keeps `probe-passed` and keeps its deterministic
evidence. It is withdrawn *with its reason* rather than deleted, because a
future reader must be able to tell a question that was **answered** from one
that became **unaskable** — and because the owner decision below could make it
askable again.

**Why P11 is a translation and not a new experiment.** The old triple existed
because `scout.run`'s only call site sat below the enumeration gate, so an
off/observe/advise triple with the enumeration off was three identical builds.
Neither half of that survives: the enumeration is unconditional, and depth is
no longer advisory — a deepened line lands in the branch's belief. `observe`
("run it and change nothing") is a setting the layer no longer has. What
remains is exactly the question P11 asked, expressed as a budget: the shipped
ration against `plyCap: 0`. **P11 is the live paired sweep the depth landing
owes**, and the depth-effect rate is measured against precisely that arm.

**AN OWNER DECISION WAS PENDING HERE — IT HAS SINCE BEEN TAKEN, AND NOT BY
EITHER OF THE OPTIONS BELOW.** *(Superseded the same day; see the
branch-versus-branch section at the top of this file.)* The depth landing turned
the cluster enumeration and the deep layer on **by default**; both are still
`probe-passed`, neither has ever been raced live. The finding is recorded
verbatim on both rows in the ledger and rendered in `PROMOTION-STATUS.md`. The
two options as posed were: the default bot keeps carrying them while the sweep is
owed, or they become config fields defaulting off until a sweep validates them.
The ruling chose neither — it declared the branch a **feature branch**, so the
features' fate is the branch's and P11 is the merge decision. P8/P9-joint stays
withdrawn and is now *subsumed* rather than merely blocked: there is no bundle in
which the enumeration runs and the branch does not.

**The batch is now 11 specs, 2,472 games** (was 12 / 2,760). Two things moved
the count and they pull in opposite directions: P8/P9-joint's 288 came off, and
P9, P10, P11 and P12 each lost a third arm — but the printed total was always
`games/arm × 2` and three of those specs really ran three arms, so the old
2,760 was an undercount of the real box time. **Every scheduled spec is a
two-arm pair now, so 2,472 is exact for the first time.** Cells and seeds are
untouched everywhere: no spec changed the board it runs on, and `n0-aa-null`
still floors the same five cells (`snake5-knight` is carried by P7F now that
P8/P9-joint is gone, not dropped).

`p8-p9-joint-cluster_enum.json` is **deleted from this directory**, and the
generator now prunes any spec it no longer emits. The local session runs the
directory, not the P-list, so a withdrawn spec whose file survived a
regeneration would be an instruction to spend a night on arms nobody can build.

---

## 20260829 — P5R IS WITHDRAWN. WASM IS GONE.

Owner ruling, verbatim:

> You should eliminate wasm. it's not worth the complexity to shoe horn another
> language into our code at 10% throughout gain.

`CENTAUR_WASM` and the whole W3 layer were deleted from
`claude/cluster-lookahead` — the AssemblyScript kernels, the linear-memory
arena, the residency machinery, the differential suite and the flag itself.
There is no arm left to race, so **P5R comes out of this batch**. The flag's
ledger row is `frozen` with the ruling quoted in its verdict, and it names no
next experiment.

**The batch is now 12 specs, 2,760 games** (was 13 / 2,952; the 192 games are
P5R's 96 per arm). Nothing else moved: no other spec's cells, seeds or content
changed, and `n0-aa-null` still floors the same five boards — `hazard-mix-king`
is carried by P10 and P11 now that P5R is gone, not dropped.

**What P5R would have answered is not answered.** Batch 1's cap-rate cluster on
`headline-mix-king` (0.229 → 0.458, turns +21.44, decisions +21.75, decisive
−0.229) is still an unexplained shape change; all the removal settles is that it
cannot be *this flag*, because this flag no longer exists. The `CELL-QUALITY`
open item — that board flips 26 of 48 placements between two builds of the same
commit — remains the leading candidate explanation and is unaffected by the
ruling.

Everything below this line was written before the ruling and is kept as the
record of how the batch got its shape. Read the P5R passages as history.

## What batch 1 changed here

Regenerated **2026-08-28** after the `20260827-overnight` fold. The batch is the
same size — 12 specs, 2,472 games, the same cells and the same seed sequences,
so nothing here is a *different* experiment from the proposal CL7 built. Three
things moved:

1. **P5R is now first, not seventh.** The list is ordered to be cut from the
   bottom, so the order *is* the priority, and batch 1 earned `CENTAUR_WASM` the
   top slot: it is the only scheduled experiment that **closes** a standing
   anomaly rather than opening a new question. Batch 1 left that anomaly as four
   ✱ rows on one cell — cap rate 0.229→0.458, turns +21.44, decisions +21.75,
   decisive −0.229 — with placement dead flat and **no way to tell whether the
   arm ran at all**. CL7 shipped the counters that settle it. If the night is
   short, P5R survives the cut.
2. **P5R reads out the whole anomaly cluster**, not just `capRate`: `turns`,
   `decisions` and `decisive` are now on its list, because a rerun that only
   re-measures the cap rate cannot confirm or clear the thing it exists to
   resolve.
3. **P7R's blocker has a name and a critical path.** It was "the miner may
   answer it without new games". It is now "the miner *cannot start* until the
   replay archive is uploaded" — the single upload that unblocks the only
   not-scheduled item in this batch.

## What the 20260829 replay-miner pass changed here

Regenerated again after the source-level pass at bundle SHA `8059b86`. **P5R is
the only experiment touched**, the batch is still 13 specs, and no other spec's
cells, seeds or content moved. Four changes, all of them to the P5R spec, all of
them made in the ledger and regenerated rather than hand-edited:

1. **Scored on throughput, not on placement.** The flag is bit-exact by
   construction *and* by test, so it cannot move `score` — placement there is
   null by design and reads as description only. What is scored is the
   engagement rate, plans per decision, decisions per second and `worstWallMs`.
   Note the standing retirement: `plansEvaluated` carries a verdict on a live
   arm **only** under simultaneous launch plus a same-cell A/A floor for the
   same statistic. Batch 1's A/A pair swung it +65% under zero treatment.
2. **`headline-mix-king` dropped**, on a measured disqualification: A/A
   turn-correlation −0.193, 5/48 games identical, 26/48 placements flipped
   between two builds of the same commit, and a cap rate spanning 0.229–0.458
   across 14 sweeps of the identical `configHash`. It cannot resolve a ~10%
   throughput effect at n=48. The alternative the evidence allows — raise *that
   cell's* n by ~4× — is not expressible, because blocks are a property of the
   spec and not of a cell. Filed as the `CELL-QUALITY` open item.
3. **Log which partition refused.** The residency check is all-or-nothing and
   returns a bare `false` from ~8 pointer tests against a fixed-size arena, so
   P5R must record *which* buffer was non-resident and by how much the arena was
   over. That is what turns a suspicion into an arena-sizing bug with an address.
4. **Simultaneous launch is now a `REQUIRES`,** not an implicit assumption.

The one recommendation **not** carried into the spec is the raised turn cap on
the snake cell. `null-snake6` runs at cap rate 0.917–1.000 — a stall rather than
play — but a cell at a different cap needs its own name and a generator that can
pass per-cell options, both of which are code. It is carried to the local session
as an operator instruction instead, and the vocabulary should gain a named
long-cap snake cell before batch 3.

## The list

**ARM NAMES IN THIS TABLE ARE PRE-TEARDOWN AND ARE HISTORY.** Read the
20260830 section above for what each spec's arms are now; the rows below are
kept for the reasoning that earned each spec its slot, which is unchanged.
P8/P9-joint's row describes a withdrawn experiment.

| id | flag | blocks | games/arm | why now |
|---|---|---|---|---|
| ~~**P5R**~~ | ~~`CENTAUR_WASM`~~ | — | — | **WITHDRAWN 20260829 by owner ruling.** The flag and the layer under it were deleted; there is no arm to race. |
| **P7F** | `CENTAUR_UNIT_FATALITY` | 16 | 144 | **Newly reachable.** The flag is `live-null` and a `live-null` used to be treated as settled, so this experiment was written out in full and silently never scheduled (`LIVE-NULL-IS-TERMINAL`, now closed). Its null is 16 blocks against the 58 its own dispersion demands — not a decision. Batch 1 also sharpened the question: on the cell the seed destroyed, the classifier's exhaustion deaths *fall* 39 → 33 (×0.85), and the `cl-both` row bounds that at inside a 48-game count's noise. So it is safe alone and it is **not** a repair for the seed. Asks whether it can be validated independently of the flag that failed. |
| **P12** | `CENTAUR_EDGE_EV` | 16 | 144 | Never raced. The probe found staged meals up (5→8) and meals *eaten* down (84→81) on piece boards — a tension only a live arm can adjudicate. |
| **P8/P9-joint** | `CENTAUR_CLUSTER_ENUM` | 16 | 144 | The strongest deterministic case on the branch (fatal stagings fall at every point of the q-curve, mean Δfloor +1.03 at the census's own regime) and never raced. Includes the graded-seed joint arm as a **diagnostic** on the seed's failure, not as a candidate for selection. |
| **P9** | `CENTAUR_SAMPLED_CAP` | 16 | 144 | Far-priced options 0→22 at q=32 with zero fatal stagings. Raced **jointly with enum**: CL3's dirty set cannot mark clean under a sampled cap, so the singles arm does not describe the shipped combination. |
| **P10** | `CENTAUR_TERRITORY_REFINE` | 16 | 144 | Sound by brute force, zero argmax flips offline, +22 µs/**evaluation**. The question is purely economic and purely live. Base arm is `enum-on`, not `off` — the refiner requires the enumeration. |
| **P11** | `CENTAUR_SCOUT` | 16 | 144 | **NOW THE MERGE DECISION for `claude/cluster-lookahead`** — `baseline` against `search-arch`, two bundles from two refs, both shipped defaults. Historical reasoning follows: The scout exists and costs 16.8 ms/decision. Every arm carries `enum-on`, base included — `scout.run`'s only call site is inside the cluster enumeration, so an `off`/`observe`/`advise` triple with the enumeration off is three identical builds and files the harness's null against the flag. Same shape as P10, and for the same reason. Within that base `observe` and `advise` are **separate arms**: observe−base isolates the tithe, advise−observe isolates the advice. One arm carrying both would report their sum. |
| ~~**P5R**~~ *(was first)* | ~~`CENTAUR_WASM`~~ | — | — | **Withdrawn.** See the ruling at the top of this file. The row it replaced argued P5R was the batch's highest-value run because it closed a standing anomaly; the anomaly is not closed, the flag is. |
| **P13** | `CENTAUR_WORKERS` | 16 | 96 | Low priority, and lower after batch 1. P1 bounds the whole substrate's strength effect at null — but its *wall-clock* rows ran the wrong way for the substrate (worstWallMs +4.02 ✱ on `snake5-queen`, +1.92 ✱ on `null-snake6`), so if this is run, read `worstWallMs` as a primary output rather than a footnote. First to cut. |
| **P16 @ 500 / 1000 / 2000** | budget ladder | 8 each | 48 each | The owner's pre-approved follow-up, and its condition is **met**: budget-probe v2 confirmed a true 1000 ms run reproduces the 2000 ms decision 91.7% of the time (flip 8.3 ± 7.0 against an A/A floor of 1.7 ± 3.2). One trail-instrumented cell — the 35% revision wave was measured pre-CL3, and cluster enumeration front-loads coordination, so the wave's own shape may have moved. |
| **X9** | the exploration slice | 4 | 36 | `TERRITORY_SLIDER_PROFILE`, `CENTAUR_STAGING_SAFETY` and `gainOrdering` each run their **opposite** branch. The ratchet guard: today's policy selects tomorrow's corpus. Mechanism-first; do not read placement off these cells. |
| **N0** | the A/A null | 16 | 240 | Mandatory, sized like the treatment cells, and its cells are now **derived** from the union of what this batch runs — five of them, not two. Batch 20260827 measured ±0.097 (mix-king) and ±0.032 (snake6) with 0 illegal and 0 errors. A wider band this time is an **instrument event**, not a nuisance. |

### N0 now floors every cell the batch treats

*Superseded. `AA-FLOOR-COVERAGE` is CLOSED and there is nothing to do by hand.*

`make-promotion-batch.js` used to hard-code the A/A null's cells as
`headline-mix-king` and `null-snake6`, whatever the treatments actually ran on.
Batch 1 measured a floor for **two of its eight cells**, and by the ledger's own
rule a metric with no floor in the A/A cell is `unreadable`, not `null` — so the
other six produced rows that had to be recorded and refused. It cost the ledger
its single best result: `TERRITORY_SLIDER_PROFILE`'s only win is on
`snake5-queen` (+0.115 [+0.014, +0.216]) and clears a *borrowed* mix-king floor
by 0.018.

The generator now derives N0's cells from the union of the scheduled specs, and
fails the batch if any treated cell is unfloored. This batch floors five:

```
headline-mix-king, hazard-mix-king, null-snake6, snake5-queen, snake5-knight
```

`hazard-mix-king` is P10's and P11's board (it was P5R's too, until the ruling),
`snake5-queen` is the slider's win cell and P12's piece cell, `snake5-knight` is
P8/P9-joint's and P7F's. N0 goes from 96 to
**240 games/arm** and it is the cheapest box time in the batch: an unfloored
treatment cell is games spent on a row nobody is allowed to read.

**The earlier instruction to add `snake5-queen` and `hazard-mix-king` to
`n0-aa-null.json` by hand is withdrawn — do not hand-edit the spec.** It is
generated, and re-running the generator would silently discard the edit.

**12 specs, 2,760 games across both arms of every pair** (was 13 / 2,952 before
the WASM ruling withdrew P5R). Batch 1 was 1,824 games in one overnight on the
24-core box, so this is roughly 1.5 nights at the same throughput. It is ordered
to be cut from the bottom.

*(Was 3,048. The 96 games came off P5R when `headline-mix-king` was dropped from
it — the same number of specs, one fewer cell on one of them. N0 still floors
that board, so nothing else in the batch changes.)*

Two changes against the 12-spec / 2,472-game version this file first described,
both of them machinery fixes landing rather than experiments being added:

- **N0 grew from 96 to 240 games/arm** by flooring five cells instead of two
  (`AA-FLOOR-COVERAGE`, above).
- **P7F is scheduled**, +288 games. `CENTAUR_UNIT_FATALITY` is `live-null`, and a
  `live-null` flag used to be treated as settled, so its named experiment was
  unreachable from the generator — even though its null is 16 blocks against the
  58 its own dispersion demands, which decides nothing. `LIVE-NULL-IS-TERMINAL`
  is closed and P7F runs. It sits **second**, behind P5R: newly unblocked and
  worth running, but not ahead of the experiment this batch was reprioritised
  around.

**What to cut, revised by batch 1.** P13 first — P1 bounds the substrate's
strength at null and its wall-clock rows now argue against the pool as well.
Then the budget ladder's **2000 ms** rung, *not* the 500 ms one, which is the
reverse of the obvious call and is what batch 1's emission trails imply: the
engine stages an incumbent in under 250 ms in 99.9% of decisions and then
revises in a single wave landing at **1000–1500 ms**, with the 250–1000 ms
window empty (8 decisions out of 102,646). It is deadline-aware — under a 1 s
budget it *reschedules* the deep pass rather than losing it — which is why a
true 1000 ms run still reproduces the 2000 ms decision 91.7% of the time.
2000 ms is the rung we already have a whole batch of; **500 ms is the only rung
that might actually amputate the second pass**, so it is where the ladder's
information is. Never cut X9, and never cut N0.

## Not scheduled, and why

**P7R — `CENTAUR_CLUSTER_SEED`'s root cause.** The flag is `live-failed` and the
next step is the **root-cause miner on the 20260827 replays**, not new games.
Two named falsifiers exist and neither needs a live arm: raise `restarts`, and
turn `rungZeroRepair` on. If the shortfall is basin choice it should vanish
under either.

**But the replays have not arrived, so the miner cannot start, so P7R is
blocked on an upload and nothing else.** That makes the archive this batch's
only true dependency.

Batch 1 also changed P7R's *shape*, so scheduling it is still one edit but it is
now a better experiment. It was a two-cell falsifier hunt; it is now a
three-cell **density ladder**, because the batch showed the seed's effect has a
sign that depends on the board:

| cell | role | what batch 1 measured |
|---|---|---|
| `null-snake6` | the failing cell | win 1.00→0.15, exhaustion ×1.92 |
| `snake5-knight` | **the discriminator** *(new)* | exhaustion ×2.09 — the *largest* ratio in the batch — with placement **null** |
| `headline-mix-king` | **the support cell** *(new role)* | placement flat, and `finalMaterial` +5.10 ✱ and `survived` +0.146 ✱ **favour the seed** |

`snake5-knight` is what makes it a ladder: it separates "exhaustion inflation"
from "placement collapse", which the two-cell design could not. A root cause
that predicts a placement loss there is wrong. And a root cause that cannot
explain why the *same* mechanism helps on a full piece roster and ruins a
snake-only board is not a root cause. The live reading is no longer "the seed is
a dead idea" but "the seed is admissible on some boards and ruinous on others,
and nothing currently decides which board it is on" — which points at a
**conditional-admission** future, the same shape `CENTAUR_STAGING_SAFETY`
already ships as `auto`.

**P4R — `CENTAUR_TIER_TRUTH=full` at ply 2.** Blocked on P11. There is no point
measuring the ply-2 prerequisite before the ply-2 consumer has been raced. This
flag will be validated on a *soundness* reason and not a placement one; the
ledger says so, so a future reader does not go looking for a placement win that
will never arrive.

Batch-1 refinement: P4 produced **no ✱ row anywhere** — not on placement, not on
mechanism, not on cost, on any of its three potion cells. That is consistent
with the n=1 no-op prediction and equally consistent with the arm not having
engaged, and the batch cannot tell them apart. The flag is now filed
`nullKind: engagement-unshown`, expressly to keep it distinct from
`CENTAUR_COHORT_POLICY`, which carries the same `live-null` status and the
opposite epistemic state. Two flags, one status word — read `nullKind` before
averaging them.

**P6R — `CENTAUR_COHORT_POLICY`.** Still deferred, but for a **different and
smaller reason than CL7 recorded**, and the correction is worth reading before
anyone reruns it.

CL7 filed P6's null as engagement-unverified "for the same structural reason as
P5". The batch-1 fold overturned that. P5 has no evidence of any kind that its
arm ran. P6 has **four ✱ harness-side rows on two independent cells** —
`worstWallMs` +5.13 [+3.41, +7.22] on `hazard-mix-king` and +5.13 [+3.31, +6.94]
on `headline-mix-king`, with `plansEvaluated` +14.3k on both — and a governor
that never admitted anything cannot cost five milliseconds of worst-case wall
time and fourteen thousand extra plans, twice, reproducibly. **Engagement is
shown.** (Using the retired `plansEvaluated` this way is inside its retirement:
it is retired as a *verdict* metric and explicitly kept as a broken-arm
diagnostic, and "did the arm run" is the diagnostic question.)

So P6 is the ledger's only **engaged-and-did-not-help** row: a measured cost
with no measured benefit, which is a real finding about the governor rather than
an absence of one. What is still missing is `admissionRate` itself — the
governor publishes no counter, so the cost is attributed to it *running* and not
to any particular admission decision. A rerun is therefore no longer needed to
establish engagement, only to interpret it, which makes the counters the whole
of the block. Its target boards remain the crowded ones: more claimants than
budget is where a governor can act at all, and mix-king may simply not be
crowded enough for admission to bind.

## Running it

**Read each spec's own `ARM CONFIGS` block — and, on P11, its `BUNDLES` block.**
Those lines are the arm; everything below is context.

```sh
# P11 — the cross-branch merge decision. Two bundles, two refs, no bot config.
tools/simworker/build-bot.sh origin/claude/mid-turn-collision-logic-mkxurg \
    ~/lobster/bundles/baseline --fetch
tools/simworker/build-bot.sh origin/claude/cluster-lookahead \
    ~/lobster/bundles/search-arch --fetch

node tools/simworker/bin/run-pair.js --batch $BATCH \
  --spec tools/learnloop/specs/batch2/p11-scout.json \
  --arm  baseline=~/lobster/bundles/baseline \
  --arm  search-arch=~/lobster/bundles/search-arch --workers 2

# The mandatory null — ONE bundle, twice, and it is the search-arch one.
node tools/simworker/bin/run-pair.js --batch $BATCH \
  --spec tools/learnloop/specs/batch2/n0-aa-null.json \
  --arm  nullA=~/lobster/bundles/search-arch \
  --arm  nullB=~/lobster/bundles/search-arch --workers 2

node tools/simworker/bin/verify-null.js --batch $BATCH --null nullA,nullB
```

Record the resolved SHA from each `bundle.json` in `findings.md`. A
branch-versus-branch verdict that quotes branch names and not SHAs is a claim
nobody can reproduce.

*The paragraph below is pre-teardown and is kept for the batch-1 audit it
describes; there are no environment flags left to mistype.*

Every arm is one seat against unchanged opponents, per the standing rule. The
off arm is set by **omitting** the variable: every CL flag parses only `1`, `on`
or `true`, with no warning on anything else, so a mistyped value is an A/A null
wearing a treatment's name.

Since the CL7 telemetry closure the per-game rows also carry the **resolved flag
stamp** — what the engine actually ran on, as opposed to what the environment
was set to. Read that. It is the only thing that distinguishes a treatment arm
from an arm that thought it was one.

Batch 1 was audited for exactly this and came back clean: sixteen arms, zero
mistyped values. `"on"` was correct for `CENTAUR_WASM` (which parsed `on|off`,
and is gone as of the 20260829 ruling) and is correct for
`CENTAUR_COHORT_POLICY` (`1|on|true`); `"full"` is correct for
`CENTAUR_TIER_TRUTH` (`off|expiry|full`); the `1|on|true` warning applies to the
five search-side CL flags, all of which were set to `"1"`. That is an audit of
the *environment*, though, not of what resolved inside the engine — the stamp
that would close it postdates those bundles. Batch 2 is the first batch where
the stamp exists, so this is the first batch where the audit can be real.

## Ship the replays

One upload does more for the program than any spec in this list. The 77 MB
archive (2,592 replays) unblocks, in order of value:

1. **P7R's root-cause miner** — the only not-scheduled experiment here, and the
   thing standing between the program and `CENTAUR_CLUSTER_SEED`'s root cause.
2. **`bin/ingest.js` against batch 1 at all.** It has never run on this batch:
   the delivery ships analysis markdown and a slimmed `manifest-core.json` with
   no per-game rows, so the tool refused with `no arms found` and every batch-1
   row in the ledger was transcribed by hand. Nothing has independently
   recomputed a CI, a pairing check, or a hygiene row from the games themselves,
   and the automatic instrument-event detectors never ran — including
   `cap-rate-asymmetry`, which is precisely the shape of the P5 anomaly a human
   had to spot instead.
3. **`EDGE-EV-EATS`** — `CENTAUR_EDGE_EV`'s primary gate metric is in the
   replays and nowhere else, and P12 is scheduled in this batch.

The full deferred list is on the ledger's batch record at
`batches[0].ingest.deferredRows`.
