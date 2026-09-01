# LOBSTER — PC Batch 3 Runner (self-contained, ~9 hours)

Maintained by the sandbox continuous runner. Last revised 2026-09-01,
after sandbox cycle k1 (the channel ladder) and the floor-scaling check.
Supersedes `$SP/batch2-runner.md` as the next package to hand over.

Slot budget: C 1.9 h + A 3.1 h + B 2.8 h = 7.8 h, inside the 9 h cap with
room for the smoke run and the publish.

You are a local Claude Code agent on the owner's machine with no other
context. Your job: run simulation batch 3 and publish the results. You
are a measurement instrument: never modify bot source, report honestly,
every number ships with its control.

**Budget: 9 hours of machine time, hard cap.** The slots below are
ordered by value, but SLOT C RUNS FIRST because it sizes Slot A. If you
run out of time, finish the slot you are in, publish what completed, and
say plainly which slot did not run. Do not compress a slot by dropping
blocks — an underpowered cell is what this batch exists to fix.

---

## 0. Why this batch (what the sandbox already learned)

Two live results set the questions:

1. **P11 is one batch away from being decidable.** Batch 2 ran it at 16
   blocks per cell; the spec requires ~73 for the ±0.10 the sharePar
   floor supports. At 16 blocks the search-architecture branch is
   already *behind* the baseline on the hazard cell — sharePar
   −0.6343 [−1.2607, −0.008] — with the mechanism rows confirming it is
   fully engaged (1,411 scout threads, 151k cluster joints per game). It
   decides differently and, so far, scores worse. Slot A finishes the
   count so the merge decision can actually be made.
2. **The potion-collecting capability is BUILT AND WORKING — and the
   prize turns out to be too small to matter.** Over 1,152 sandbox games
   in five cycles, `candidates.potionOrdering` (a potion pickup sorts as
   a gain) makes the bot collect **22% more potions on a hazard cell and
   45% more on a hazard-free one** than the byte-identical bot without
   it, in the same games, at zero search cost. And on the hazard-free
   cell it scores **+0.021 [-0.143, 0.213]**: 45% more potions, no score.
   On the hazard cell it is a net LOSS of -0.145 [-0.258, -0.035],
   replicated at -0.146 and -0.143 in two independent runs, through a
   fully measured chain — potions +22%, hazard occupancy +5%, head
   entries into hazard +4%, deaths per game +13%.

   So the open question is no longer about the bot. It is **at what
   potion settings is a potion worth chasing**, and that is what Slot B
   now runs, at the owner's real shape where the answer counts.

   The advisory slate is separately CLOSED: it moves the estimate by
   under 1% of the width of the interval it moves inside, costs 14-44% of
   plans per decision, and adds +0.001 sharePar over the free flag. Do
   not spend this box's hours on it.

Slot C is the concurrent A/A control both slots are claimed against.

**One methodological warning carried from the sandbox, which applies to
this box too.** Two byte-identical arms there did not buy the same amount
of search: the first-launched arm evaluated 8.9% more plans per decision
on average and 31.6% more inside one 12-game window, at identical wall
clock. Every cell is `budgetMs`-bounded, so CPU service converts straight
into search depth, and a large part of what this programme calls the A/A
floor is the box rather than the board. **Record plans per decision per
arm in every cell and report it beside the floor.** If your two identical
arms differ by more than a couple of percent, say so — with
`--workers 10` on 24 threads you have more headroom than the sandbox
does, and it would be genuinely useful to know whether the effect is
absent there.

---

## 1. Repos and branches (fetch these exactly)

| repo | URL | refs you need |
|---|---|---|
| Chris-Centaur | https://github.com/Battle-Bunker/Chris-Centaur.git | `sim/worker-kit` (kit — your working branch), `claude/mid-turn-collision-logic-mkxurg`, `claude/cluster-lookahead` |
| TacticToes (reference only) | https://github.com/Battle-Bunker/TacticToes.git | default branch |

```bash
git clone https://github.com/Battle-Bunker/Chris-Centaur.git
cd Chris-Centaur
git fetch origin sim/worker-kit \
  claude/mid-turn-collision-logic-mkxurg claude/cluster-lookahead
git checkout sim/worker-kit          # expect 17183e9 or later
npm ci                               # Node 20 LTS or 22, via nvm
```

Work inside the Linux home directory (`~/...`), never under `/mnt/c`.
You must be able to push `sim-results/*` branches.

**Read `tools/simworker/HANDOFF.md` first** — it is the operating manual
and supersedes this file wherever they disagree. Then read every
`tools/simworker/COORDINATION-*.md` addendum, newest last.

### Bundles to build (exact SHAs — pinning matters)

```bash
cd ~/lobster/Chris-Centaur
tools/simworker/build-bot.sh 66904d256103a1d3f32d060fe742e98b092d33b6 ~/lobster/bundles/b3-baseline --force
tools/simworker/build-bot.sh b68ce98d54f1dbc8db4a453e2af193f7a92ef9fa ~/lobster/bundles/b3-search   --force
```

`b68ce98` is deliberate, not stale: it is the **exact** bundle batch 2's
P11 ran. Slot A's blocks pool with batch 2's 16 only if the bundle is
byte-identical, and `claude/cluster-lookahead` has moved since (`83c486e`,
`06ddd05`). Build from the SHA, not from the branch name.

Slot B's bundle depends on the potion branch reaching origin — see §3.

---

## 2. SLOT A (~3.1 h) — finish P11 to a decidable read

**The question.** Should `claude/cluster-lookahead` merge to primary?

**The design.** Same spec shape as batch 2's `p11-scout`, on the two
interpretable cells only, with **57 fresh blocks per cell** so that
pooling with batch 2's 16 reaches the 73 the power calculation demands.

- Cells: `hazard-mix-king` and `headline-mix-king`. Both 25x25, 3 teams
  x 6 units, 2000 ms, turn cap 120, food initial 0.5-equivalent per the
  batch-2 spec, potions false; `hazard-mix-king` adds hazards `cross`.
- **`null-snake6` is DROPPED.** 90% of its games ended on the turn cap in
  batch 2; it measures a stall, not play. Do not re-run it. If you want
  the third cell back, raise its cap to 200 and treat it as a new cell
  with its own 73 blocks — but only in a later batch, not this one.
- Seeds: 57 fresh seeds that do **not** appear in batch 2's
  `p11-scout.json`. Full 3-seat rotation, paired across arms.
- Arms, shipped defaults on both sides, no bot config on either:

```
--arm baseline=~/lobster/bundles/b3-baseline
--arm search-arch=~/lobster/bundles/b3-search
```

**Size.** 57 blocks x 3 rotations x 2 cells = 342 games per arm, 684
total. At batch 2's measured rate on this host (288 games in 79 min with
`--workers 10`, ~218 games/h) that is **~3.1 h**.

**But do not take 57 on faith — Slot C recomputes it.** The 73-block
target assumes the floor falls as 1/sqrt(blocks), and the sandbox has now
found a cell where it does not. Run Slot C first; if its scaling check
says a cell is heavy-tailed, recompute that cell's target from its
measured 32-block floor before spending three hours on it. If the honest
target is out of reach in this batch, run what you can and **report the
floor you reached, not the one the spec assumed** — an underpowered run
labelled as decisive is the exact failure this batch exists to end.

**What to report.** Both the fresh-57 reading and the pooled-73 reading,
separately, in that order, each against the A/A floor from Slot C at the
matching block count. If they disagree, say so and prefer the fresh
sample — pooling across batches is an assumption, the fresh run is not.

**The decision rule, written before the data (do not revise it after).**
The interval below is the READING'S OWN bootstrap interval over blocks —
not the A/A floor, which measures a different quantity and is roughly
twice as wide by construction (see §6).

| pooled sharePar Δ (search−baseline), reading's own 95% interval | verdict |
|---|---|
| entirely below −0.10 | the branch LOSES; do not merge; the search architecture is a cost without a return at this shape |
| entirely above +0.10 | the branch WINS; merge |
| contains zero, half-width under 0.10 | genuine null at the resolution the data support; merge only on grounds other than strength (cost, clarity, what it unblocks) — and say which |
| half-width over 0.10 | still underpowered; report the number and the blocks still owed |

Two side conditions, both of which can veto the row above:
- the Slot C A/A null on that cell must CONTAIN zero (bias check), and
- the fresh-57 and pooled-73 readings must agree in sign. If they do not,
  report both and call the cell unresolved rather than picking one.

Also carry the mechanism rows (`scoutThreads`, `scoutPlies`,
`clusterJoints`, `clusterEnumMs`, `overrunRate`, `worstWallMs`). Batch 2
found cluster enumeration eating ~32 s per game — about 20% of the whole
decision budget — and that cost is part of the merge decision even if the
score is a null.

---

## 3. SLOT B (~2.8 h) — at what potion settings does collecting them PAY?

**Run this slot only if `feature/potion-intel` (or `tmp/potionplay`) is
on origin.** Check first:

```bash
git ls-remote origin | grep -Ei 'potion'
```

If nothing comes back, **skip Slot B, say so in the findings, and spend
its hours on Slot A2 in Section 5 instead.** Do not substitute a
different bundle; this slot needs the `candidates.potionOrdering` flag,
which exists only on that branch.

If it is there, build from its tip:

```bash
tools/simworker/build-bot.sh origin/<the potion ref> ~/lobster/bundles/b3-potion --force
```

**THE QUESTION HAS CHANGED since the last revision of this file, because
the sandbox answered the old one.** The old question was whether potion
intelligence pays at a bigger budget. The replays now say the bot's
potion behaviour was never the problem:

> `candidates.potionOrdering` — a potion pickup sorts as a gain, so the
> collection move enters the priced set — makes the bot collect **22%
> more potions on a hazard cell and 45% more on a hazard-free one** than
> the byte-identical bot without it, in the same games, at ZERO search
> cost (it evaluates 1.7-3.7% MORE plans per decision than plain).
> And on the hazard-free cell it scores **+0.021 [-0.143, 0.213]** —
> 45% more potions, no score. The prize is too small.

So the collecting capability is built and demonstrably working, and the
open question is about the GAME rather than the bot: **at what potion
settings is a potion worth chasing?** That is a board-settings sweep, and
the owner's box can run it at the owner's real shape, which is the only
place the answer counts.

**The design.** Both-sides-one-game as in Slot C: `potionOrder` and
`plain` seated in ONE game with `rotateSeats:true`, so G is a within-game
contrast, and two identical arms so the pair carries its own A/A null.

Contenders (both `base: lobster-territory`):

```json
"potionOrder": { "bot": { "name": "potionOrder",
                          "candidates": { "potionOrdering": true } } },
"plain":       { "bot": { "name": "plain" } }
```

Cells — the owner's shape, hazards OFF so the hazard interaction does not
confound the value question: 25x25, 3 teams x 6 snakes, 2000 ms, turn cap
120, food initial 6 / rate 0.5, hazards none, potions enabled
`spawnRate 0.15, initial 2`, and **`effectTurns` as the swept axis**:

| cell | effectTurns | what it asks |
|---|---:|---|
| `p3-potval03` | 3 | the current setting — reproduces the sandbox null at the owner's shape |
| `p3-potval08` | 8 | is a potion worth chasing when it lasts a normal exchange? |
| `p3-potval20` | 20 | is it worth chasing when it is decisive? |

**Size.** 32 blocks x 3 rotations x 3 cells = 288 games per arm, 576
total, ~2.8 h at this host's measured 218 games/h.

**What to report, in this order:**
1. **The value curve** — G = sharePar(potionOrder) − sharePar(plain) at
   each `effectTurns`, with each cell's own interval. Does it cross zero,
   and where?
2. **The behaviour check** — potions collected per game per bot, from the
   replays. If `potionOrder` is not collecting materially more than
   `plain` at the owner's shape, the flag is not engaging there and
   nothing else in this slot means anything. The sandbox tool is
   `replaymech.js`; the counts come from each turn record's
   `world.potionsCollected` entries (`{unitID, cell}` — the team is the
   `unitID` prefix), attributed to bots via the header's `seats`.
3. Plans per decision per bot, confirming the flag is still free at
   2000 ms.

**Why this is worth 2.8 hours.** If the curve crosses zero at
`effectTurns` 8 or 20, the owner has a potion-intelligent bot today — the
flag exists, it is free, and it wins on boards where potions matter. If
it never crosses, the honest finding is that invulnerability potions are
not worth chasing in this game at any setting the harness offers, and the
potion effort should STOP rather than deepen. Both answers are worth
having and neither is available from a smaller box.

**One thing NOT to run:** the advisory slate ladder (`potion-aware`,
`potion-aware-bold`). The sandbox has closed it — the advisory moves the
estimate by under 1% of the width of the interval it moves inside, costs
14-44% of plans per decision, adds +0.001 sharePar over the free ordering
flag, and collects only 0.05-0.15 more potions per game. It does not need
a bigger box; it needs deleting or rebuilding.

---

## 4. SLOT C (~1.9 h) — the concurrent A/A control, AND the scaling check
## that tells you whether Slot A's 73 blocks mean anything

**RUN THIS SLOT FIRST. It sizes Slot A.**

Slot B's design carries its own floor. Slot A does not — it is
arm-paired, so it needs a same-night A/A cell sized like its treatment.

- Two byte-identical `b3-baseline` arms, `nullA` vs `nullB`.
- The same two cells as Slot A, same shape, **32 fresh blocks each**.
- 32 x 3 x 2 = 192 games per arm, 384 total, ~1.9 h.

Then run `verify-null.js`. If the A/A interval on either cell excludes
zero, **stop and report that** — the box is not delivering equal service
to the two arms and no Slot A number from that cell can be claimed.

**Then do the scaling check, which is the part that is new.** The "73
blocks per cell" figure in Slot A comes from a power calculation that
assumes the A/A floor shrinks as 1/sqrt(blocks). **That assumption has now
been tested in the sandbox and it does not always hold.** Computing the
floor on nested prefixes of one run's own blocks — same games, same cell,
only the count changing — the interior-hazard cell obeyed 1/sqrt(n)
(ratios 1.21, 1.11, 0.97, 1.00 at 6/12/18/24 blocks) while the plain
snake cell did not: its floor fell only from 0.634 to 0.518 between 12
and 24 blocks where 1/sqrt(n) predicts 0.448. That is the signature of a
heavy-tailed outcome distribution, and on that cell a ±0.19 floor needs
~178 blocks rather than the ~32 a naive calculation gives.

So, on each of Slot C's two cells, compute the A/A floor at 8, 16, 24 and
32 blocks from the same run, and report:

| cell | blocks | A/A floor | expected = floor_32 x sqrt(32/n) | ratio |

A ratio near 1.00 across the row means the cell scales and Slot A's 73
blocks buy what they promise. Ratios well under 1 at the small end mean
the cell is heavy-tailed, **and Slot A's target must be recomputed from
the measured floor at 32 blocks** — `blocks_needed = (floor_32 / 0.10)^2
x 32` — before you run it. If that number exceeds what the remaining
hours can buy, say so in the findings and run the blocks you can, quoting
the floor you actually reached instead of the one the spec assumed.

The sandbox tool that does this is `floorscale.js`; it is 90 lines and is
described in `$SP/continuous/` if it can be shared, but re-implementing it
from the description above is straightforward — bootstrap the between-arm
difference of the per-block reading over nested prefixes.

Finally, **record plans per decision per arm** on every cell (see the
warning in §0) and report it next to the floor.

---

## 5. SLOT A2 (fallback, ~3 h) — only if Slot B is skipped

If the potion branch is not on origin, spend Slot B's hours on the
**piece-cell floor calibration** (queue item 4), which every future
piece-bearing reading depends on and which no amount of sandbox time can
settle at the owner's shape:

- `b3-baseline` against itself, `nullA` vs `nullB`, on
  `headline-mix-king` (the cell whose sharePar floor widened to ±0.53 in
  batch 2 — wide enough to make its treatment rows unreadable).
- Blocks at 16, 32, 64 — three separate pair runs on disjoint seeds, so
  the floor can be plotted against block count rather than assumed to
  fall as 1/sqrt(n).
- 112 blocks x 3 rotations = 336 games per arm, 672 total, ~3.1 h.
- Report the three half-widths and whether they fall as 1/sqrt(n). If
  they do not, the mix-king cell has a heavy-tailed outcome distribution
  and **every** reading on it needs a different estimator — that is a
  bigger finding than any single treatment.

---

## 6. Non-negotiable methodology

- One contender-pair at a time. Record `nproc`, memory and loadavg in
  the manifest; nothing else heavy on the box while a pair runs.
- Paired seeds, full 3-seat rotation; a block is one seed through all
  rotations.
- **Seat isolation**: a bot config must resolve to exactly one seat
  (`bot@<seat>=`). A bare `bot=` with two or more configurable
  contenders is refused by the kit naming the fix — that refusal is the
  kit working, not a bug to route around. Check `seatConfigs` in every
  `arm.json` and in the manifest before trusting a cell.
- `sharePar` leads every table. `score` is a rank, blind to margin, and
  is carried only for continuity with older findings. When they
  disagree, `sharePar` is the one being optimised.
- Every delta is quoted against a floor **in its own units**, from
  `verify-null.js`. A sharePar delta may never be read against a rank
  floor. No floor, no claim.

- **BUT DO NOT USE THE A/A FLOOR AS THE EFFECT-SIZE THRESHOLD. This rule
  was wrong and the sandbox caught it suppressing a real result.** The
  floor is the spread of the DIFFERENCE between the two arms; the reading
  is their AVERAGE. For independent arms of equal per-block variance v,
  the difference has variance 2v and the average v/2, so **the floor is
  about twice the reading's own half-width by construction, at any sample
  size** — measured in the sandbox at 2.63 and 1.96 against a theoretical
  2.00. Requiring |delta| > floor therefore demands roughly twice the
  effect the data actually require.

  Use each instrument for what it measures:
  - **A/A null → BIAS.** Two identical arms must average to zero. If that
    interval excludes zero, stop: the pipeline is not delivering equal
    service and nothing from that cell is claimable.
  - **The reading's own bootstrap interval over blocks → EFFECT SIZE.**
  - **Replication across independent runs → CONFIDENCE.** In the sandbox
    the same contrast came back -0.146 and -0.143 on disjoint seeds; that
    agreement is worth more than either run's interval, and no single run
    can produce it. Where the hours allow, prefer two runs on disjoint
    seeds over one run of twice the length.

  Report the floor beside every delta as before — it is the bias check and
  it carries real information about the box — but say plainly which of the
  three roles each number is playing.
- A mechanism counter that stayed at zero on a treatment arm means the
  arm never engaged — report that as a different thing from a null.
- Report negative and null results with the same prominence as wins.
  Never patch bot source; if a build fails, document it and continue.
- Start with the 10-minute smoke from the HANDOFF (1 block, small board,
  short budget) and take it all the way through the push and the draft
  PR before the first real cell.

## 7. Results protocol

1. Branch `sim-results/local-<YYYYMMDD>[-<n>]` off
   `claude/mid-turn-collision-logic-mkxurg`.
2. Commit under `results/<batch-id>/`: `manifest.json` (cells,
   contenders with build refs + SHAs and their bot-config JSON, seeds,
   host info, node version, times), replays as `*.jsonl.gz` (sample per
   HANDOFF if over ~200 MB), `findings.md` — **A/A control cell first**,
   then the verdict lines and tables, `sharePar` column leading — and any
   local tooling under `tools/simworker-local/`.
3. `git push -u origin <branch>`; open a draft PR titled
   `Sim results: <batch-id>` (base:
   `claude/mid-turn-collision-logic-mkxurg`).
4. Tell the owner the batch landed, which slots ran, and — first line —
   the Slot A verdict against the decision rule in §2.

Never push outside `sim-results/*`. Never modify `src/`.
