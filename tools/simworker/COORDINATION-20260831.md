# Coordination — 2026-08-31: batch 2 is folded, and two of your tools were guessing

**Batch 2 landed, was machine-ingested, and its numbers hold.** This note is
about the three things a session holding a `sim/worker-kit` checkout needs before
it runs anything else: two defects fixed in `bin/`, one change to what a delta
has to clear before the loop will read it, and what batch 3 should be.

```sh
git fetch origin && git checkout sim/worker-kit && git pull --ff-only
node tools/simworker/bin/selftest.js          # 53 assertions (was 33), no bundle needed
node tools/learnloop/bin/selftest.js          # 147 assertions (was 131)
```

---

## 0. THE HEADLINE: the delivery's published numbers are correct

You reported two `aggregate.js` defects and worked around both rather than
patching, so that this batch's numbers stay comparable with others. **That was
the right call and the numbers survived it.**

Checked rather than assumed: **816 published delta values, across 11 pair files
and 29 cells, were recomputed from the raw manifests by an independent
implementation. Zero disagreed** beyond one rounding tie (`-0.03125` printing as
`-0.0313` vs `-0.0312`).

- **The sign-inverting seat defect did not reach a single published table.**
  Every `analysis-*.json` in the delivery carries
  `subject=…:lobster-territory` on both arms, because you passed `--subject`
  explicitly everywhere.
- **The floors are right too — and that one was luck, not care, and not yours.**
  `verify-null.js` has no `--subject` flag at all. It picked the seat by reading
  the first row of `manifest.jsonl` and taking the first `lobster*` in it, which
  is a race on two counts (completion order; rotating seats). It happened to
  land on `lobster-territory`. **Had it landed on `lobster-material`, this
  batch's tightest and most-quoted floor would have been `null-snake6` `score`
  ±0.0725 instead of ±0.0324 — 2.2× wider, silently, with every verdict in the
  batch read against it.**

---

## 1. `aggregate.js` and `verify-null.js` no longer guess which bot they measure

### The subject seat — defect A, fixed properly rather than worked around

The old fallback read one game's seat list. It is now **derived or declared,
never guessed**, in this order:

1. `--subject-map <arm>=<bot>` if it names the arm, else `--subject`;
2. else, if the sweep seats exactly one candidate contender, that one;
3. else, **if exactly one candidate seat's RESOLVED STAMP differs between the
   arms, that seat is the treated one** — read off `mechanism.config` /
   `mechanism.flags` on the game rows, printed in the output as
   `subjectHow`, so a reader can check the choice instead of inheriting it;
4. else it **refuses, exits 3, names both candidates and prints the spelling
   that fixes it** — before computing anything, so no half-written analysis is
   left on disk.

**What this means for you in practice.** Your config-pair sweeps (P7F, P9, P10,
P12, X9, and P11's depth pair) now resolve `lobster-territory` *by themselves*,
from the data, and return the correct sign with no flag passed. Your
whole-bundle pairs (N0, P11's branch pair, P16's three rungs, P13) **refuse**
until you name the seat — correctly, because both seats carry a different build
there, both are legitimately readable, and which one you read is an analysis
choice rather than a fact in the data. Keep passing `--subject lobster-territory`
for those.

`verify-null.js` gets the same treatment plus a `--subject` flag it never had,
and it now stamps the floor with the seat it belongs to.

### The absent base arm — defect B, fixed at the cause

`TypeError: Cannot read properties of undefined (reading 'get')` at
`aggregate.js:531`. `--base` names one arm for the whole **batch**, and no arm is
in all of a batch's sweeps — N0 in particular floors every board and shares no
arm with any treatment. The integrity gate already fell back to `present[0]`;
the delta loop did not.

**The base is now resolved per sweep**, reported per sweep in both the JSON
(`base`) and the markdown, the delta column is labelled with the base it was
actually taken against, and the substitution is recorded as an integrity
problem. **`aggregate.js --batch <whole batch> --subject lobster-territory` now
runs to completion over all eleven sweeps in one pass** — your
`analyze-sweep.sh` symlink workaround still works and is no longer needed.

**Both defects are regressions in `bin/selftest.js` now** (§3–§5, 20 new
assertions), on synthetic batches with planted answers — including a fixture
that plants a −0.4 effect on a near-zero-sum board and asserts the tool returns
−0.4 and not +0.4.

### Your documentation discrepancy (§6C) is confirmed and the doc is wrong

A bot config merges into the **first** configurable contender, not every one.
Measured behaviour is right, the Handoff text is stale, and the tip already
refuses a bare `bot=` on a two-lobster spec.

---

## 2. A delta must now clear the floor WITH ITS WHOLE INTERVAL

`bin/ingest.js` tested `|mean| > halfWidth`. That is "my best guess is bigger
than noise", which is not the same claim as "the data are incompatible with
noise", and it is satisfied by an interval lying almost entirely inside the band.
It now tests **`lo > halfWidth || hi < −halfWidth`**.

**This is your own test.** `findings.md` used it, deliberately, to decline
exactly one row — `unit-fatality` on `null-snake6`, sharePar
**+0.1542 [+0.0249, +0.2835]** against a **±0.1173** floor — and named it so
nobody would rediscover it as a win. **Under the old code the machine claimed
it**, moving `CENTAUR_UNIT_FATALITY` from `live-null` to `supported` on the
all-snake inert roster, for a classifier whose question is about boards that
field pieces. The ledger should not need a human to decline on its behalf.

### What it costs, batch-wide, and this is the number to sit with

**Of 79 deltas in batch 2 whose 95% interval excludes zero, only 26 clear their
own A/A half-width. 50 sit inside it. 3 are on counters whose A/A itself excludes
zero.**

`findings.md` applied the strict test to its **placement** rows and "excludes
zero" to its **mechanism** rows, which is why its headline is *"the mechanism
rows are where the information is"*. Held to one standard, what survives is:

- **P11b, the depth ration — 10 rows, the cleanest in the batch.**
  `clusterEnumMs` −31,938 against a ±6,374 floor (5×), plus `scoutPlies`,
  `scoutThreads`, `scoutRefusals` on all three boards.
- **P16's deadline breach — up to 90×.** `overrunRate` +0.2176 against ±0.0024;
  `worstWallMs` +314.75 against ±21.75.
- **P11a's cost rows** on `null-snake6`: `worstWallMs` +38.5 against ±10.49.
- **P9 on `null-snake6` only** — `clusterEnumMs`, `scoutPlies`, `scoutRefusals`.
- **X9's `deathsSelf`** +0.5 against ±0.0648, 7.7× the floor.

**Two of your named results do not survive, and one of them inverts:**

- **P9's `ceilingDecided` on `snake5-queen`.** You quote −2,852 [−4,854, −850]
  as a headline separation. **The A/A on that same counter and board reads
  −3,407.67 [−6,024.21, −791.13].** The two *identical builds* moved it more
  than the treatment did. There is no floor there at all.
- **P7F has no surviving row.** `finalMaterial` −6.375 against a ±6.906 floor,
  `survived` −0.1458 against ±0.2415: both inside. The adverse-mechanism
  sentence needs withdrawing.

None of this changes a placement verdict — they were all null already.

---

## 3. Three corrections to `findings.md`, in descending order of consequence

### 3a. "It is not the box" does not survive flooring every metric

Your argument rests on `null-snake6` reproducing batch 1's `score` floor to
three decimals (±0.0324 vs ±0.032). **It does.** But the ingest floors every
metric, not only `score`, and compared against batch 1's report it fires
`null-band-widened` on five:

| cell / metric | batch 1 | batch 2 | ratio |
|---|---|---|---|
| `headline-mix-king` / `score` | ±0.0973 | ±0.1605 | ×1.65 |
| `headline-mix-king` / `place` | ±0.1945 | ±0.3210 | ×1.65 |
| `headline-mix-king` / `worstWallMs` | ±7.37 | ±21.75 | ×2.95 |
| **`null-snake6` / `worstWallMs`** | **±0.59** | **±10.49** | **×17.76** |
| `null-snake6` / `turns`, `decisions` | ±0.837 | ±1.772 | ×2.12 |

**The snake board's wall-clock floor widened seventeenfold.** It is not that
`null-snake6` was unaffected — it is that a board whose games end on the 120-turn
cap rather than on the clock is insensitive *in the placement column* to a
timing perturbation that is plainly present *in the timing column*. At load
21–24 of 24 cores, the widening corroborates the open `Cell-Quality` item
**less** than the write-up claims and run conditions **more**. Batch 3 separates
them for ~576 games: run N0 alone on an idle box.

### 3b. The 500 ms and 1000 ms rungs are UNREADABLE, not null

The A/A ran only at 2000 ms and P16's cells are named `<board>@<ms>`, so those
two rungs have **no floor of their own**. The 2000 ms floor may not be lent to
them — *that noise differs with budget is the experiment's own hypothesis*. The
mechanism rows stand on their own margins; the placement sentences about those
two rungs do not, in either direction. **Batch 3 must floor every rung it
races.**

### 3c. Three denominators for the 500 ms deadline-miss rate, and they differ

- **21.8%** — per-game mean of per-game rates (what `findings.md` quotes).
- **13.2%** — decisions-weighted, over all 758 `lobster-territory` decisions in
  the cell.
- **9.9%** — the drift detector's hygiene denominator.

All three are correct readings of different things. The per-game mean
over-weights short games. For a latency claim, quote the decisions-weighted one.

---

## 4. What the batch actually bought, and it is not on your list

### The search-arch build takes 7.5× longer to produce its FIRST plan

Time to first staged plan, `lobster-territory`, `headline-mix-king`:

| build | p50 | p90 | max |
|---|---|---|---|
| `integrated` (baseline) | 46 ms | 132 ms | 475 ms |
| `perf-substrate` (search-arch) | **343 ms** | **527 ms** | **1,123 ms** |

**And it is budget-independent** — 343 / 311 / 326 ms at the 500 / 1000 /
2000 ms rungs. That is a fixed setup cost paid *before any anytime behaviour
begins*, not a share of the budget.

**So: does the kernel degrade gracefully or stage stale plans? Neither.** At the
500 ms rung, **100 of 100 overrunning decisions had `firstStageMs > budget`**
(median 560 ms) — every miss is a miss on the *first* plan. At 1000 ms only 4 of
23 are. And `emissions == 0` on **0 of 100**: it never returns nothing and never
stages something stale. Every miss is *a move, late*.

**The setup cost is the enumeration.** `clusterEnumMs` on that board at that
rung is **337 ms per decision** — the same number.

### The enumeration has two cost regimes, and a knight is free

| board | roster | ms/decision | share of 2000 ms | joints/decision | **ms per joint** |
|---|---|---|---|---|---|
| `null-snake6` | 6 snakes | 18.3 | 0.9% | 41.0 | 0.45 |
| `snake5-knight` | 5 snakes + knight | **18.0** | **0.9%** | 42.5 | 0.42 |
| `snake5-queen` | 5 snakes + queen | **223.8** | **11.2%** | 52.9 | **4.23** |
| `hazard-mix-king` | mixed + king | 422.5 | 21.1% | 2,489.6 | 0.17 |
| `headline-mix-king` | mixed + king | 474.5 | 23.7% | 2,471.1 | 0.19 |

**A knight costs exactly what a snake costs. A queen costs twelve times a
knight, on 1.25× the joints** — so the queen's cost is not *more* clusters, it is
*bigger* ones, and the exact small-cluster enumeration inside them explodes. The
mix-king boards are the opposite: 47× the joints at a twentieth of the cost each.
A *slider* regime wants a cluster-size bound; a *crowd* regime wants a
cluster-count bound. These are different remedies and the pinned
"~20% on piece boards, 3.5% on snakes" framing hides both.

### Your three decision errors are one defect, on one board, with a name

All three replays carry the same throw:

    BoundsInversionError: inverted ScoreBounds [lo, hi]: bank floor=B0 ceiling=B3

| arm / game | turn | bounds | gap | relative |
|---|---|---|---|---|
| `nullA` / `snake5-queen-s54506-r1` | 105 | `[149.7698, 149.7502]` | 0.0196 | 1.3e-4 |
| `default` / `snake5-queen-s69705-r0` | 78 | `[60.0150, 60.0000]` | 0.0150 | 2.5e-4 |
| `sampled-cap` / `snake5-queen-s69711-r1` | 103 | `[251.3184, 251.2998]` | 0.0186 | 7.4e-5 |

Floor above ceiling by 1e-4 to 3e-4 **relative** — a floating-point accumulation
signature, not a logic error. `overrunMs: 0`, wall 89–175 ms of a 2000 ms budget:
it threw early, it did not time out. The *categorical* case (a DEAD ceiling under
a finite floor) was fixed at `018d780` and that fix **is** in `b68ce98`; this is
the residual *numerical* case and wants a tolerance.

- **All on `snake5-queen`** — the board with ten times the per-joint enumeration
  cost, i.e. the deepest accumulation chains in the batch. ~1 in 104 games there,
  0 everywhere else.
- **Not arm-specific**: one is an untreated `nullA` build.
- **The cost in play is a forfeited turn.** Over 5,520 lobster game-seats,
  `errors > 0`, `stagedNothing > 0` and `unstaged > 0` are true on the same three
  seats and no others.
- **`boundsInversions` recorded 0 on one of the games that threw.** The counter
  that names this failure does not count it — and it is RETIRED, so nothing
  watches it. Fix the counter before trusting a future reading of it.

Filed as batch-3 item **B2**: zero games, a unit test from the three recorded
bound pairs.

---

## 5. P11: what it can say, and the cheapest way to make it decidable

**THE MERGE IS NOT DECIDED, AND MAY NOT BE DECIDED FROM THIS RUN IN EITHER
DIRECTION.** Your write-up says this and it is right; the ledger now records it
in the same words.

**What the 16 blocks did buy, and it is a real pass/fail at any size:** the
engagement gate passes (`scoutPlies` 136,806 / 137,647 / 101,137;
`clusterJoints` 14.6M / 15.1M / 388k), the direction is negative on all three
boards, and the search cost clears its floor on `null-snake6`
(`worstWallMs` +38.5 against ±10.49). **The signs are worth someone's attention
and nobody's conclusion** — a true +0.2 sharePar sits comfortably inside those
intervals.

**The cheapest decidable read is ONE board, and it is `null-snake6`.** Blocks
scale as (spread/target)², so the price is set by the board's own dispersion, and
batch 2 floored all three: ±0.1172 on `null-snake6` against ±0.7413 and ±0.7893
on the mix-king boards — a factor of six. Reading the merge on the mix-king
boards is the entire reason it is a 1,314-game item.

| shape | games | box time | decides? |
|---|---|---|---|
| **`null-snake6` at 73 blocks + its own A/A at 73** | **876** | **~5 h** | yes, to ±0.10 there |
| three boards at 73 blocks + A/A | 2,628 | ~2.9 nights | yes, on all three |
| what ran (16 blocks, 3 boards) | 288 | ~1.5 h | **no** |

**The cost of narrowing, stated rather than buried.** `null-snake6` is where the
branch is engaged but least loaded — 388,220 joints a game against 14.6M on
`headline-mix-king` — so it is where the branch has the *least* room to help. **A
null there does not license a null on the owner's board.** It answers the
branching policy's question and not the owner's board's question.

**And one thing should probably land before you spend the 876 games:** if the
branch is paying a fixed 340 ms setup tax before its first plan on piece boards
(§4), a merge decision taken now is a decision about a build that is expected to
change.

**Also owed, and cheap.** The A/A is two *search-arch* builds by the shared-bundle
convention, so P11's **baseline arm has no floor of its own** and the merge is
read against the challenger's noise. One extra A/A pair on the same single cell
closes it.

---

## 6. Batch 3, re-ranked

`tools/learnloop/specs/batch3-candidates.md` carries the full specs. The two new
top items **cost no games at all** — the evidence is already in the replays and
what is owed is a code change:

| # | item | games | one line |
|---|---|---|---|
| **1** | **B1** first-plan latency | 0 + a re-run | 7.5× setup cost, budget-independent, explains every 500 ms miss |
| **2** | **B2** the residual bank inversion | **0** | one defect, one board, a tolerance and a counter that lies |
| **3** | **B3** floor every rung, re-floor the headline board | ~576 | a batch cannot be read better than its null |
| 4 | **R3** P11 at real power | **876** (was 1,314) | one board, not three |
| 5 | **R1** evaluator selection at the owner's shape | 1,152 | still the only open item that changes what ships |
| 6 | **R5** what the enumeration buys | 384 + a branch | now with two cost regimes, priced per decision |

Below that, R2, R4, R7, R8, MS1/R9 as ranked before.

**Still true and still blocking:** no configured bot reads potions
(`SlateId` had one member when this batch was specified), so every potion arm
remains unrunnable until the second slate member is selectable.

---

## 7. What did NOT change

- **No status moved that the rules did not justify.** Five flags moved
  `probe-passed → live-null` on live paired evidence with a verified null and a
  shown engagement. Nothing was promoted, nothing failed.
- **No verdict in `findings.md` was overturned.** Three were *refined* and two
  named claims were withdrawn; every placement verdict stands as null or
  unreadable, exactly as delivered.
- **The batch stands.** Three thrown decisions in ~198,000 is 1.5e-5, the failure
  is understood, its blast radius is one forfeited turn, and all three games were
  still won by the affected bot. `lib/drift.js`'s "a nonzero integrity counter
  voids the BATCH" is applied as it was in batch 1: named, not enforced.
- **The mirror rule holds.** `tools/learnloop/` is a verbatim copy from
  `claude/cluster-lookahead`; edit it there and re-copy. The `mirroredFrom` stamp
  in `promotion-ledger.json` names the commit this copy came from.
