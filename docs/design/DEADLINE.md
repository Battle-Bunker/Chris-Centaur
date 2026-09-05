# DEADLINE — what the kernel does when the clock runs out

`BUDGET.md` §6 ends on the shape of the production risk: *"the risk is a
deadline that shrinks below ~150 ms, not one that fails to grow."* This is the
bottom of that curve, driven rather than argued — the kernel run at five
cutoffs down to a deadline that had already passed before `decide` was entered,
and the wall-clock path run under a late `endTime`, jitter and a host twice as
slow.

**The anytime property holds everywhere, and nothing else does.** In 24 arms —
four classes, seeds 1–3, sixty turns, six budgets from 1× to already-expired —
the kernel never once emitted no record and never once left a live unit off the
wire. What a shrinking deadline costs is play: from 1× to expired, deaths rise
2.7× on `mixed` and meals fall to a fifth. And below about a quarter of the
shipped budget a third thing appears that is not present above it: **the answer
starts landing on cells the bank's own floor calls DEAD while a single-unit
change would lift it off** — 0.0% of answers at 0.5× and 1×, 3.1% with the
deadline gone.

Two holes were found and fixed, both in what the kernel could SAY rather than
in what it does. One arm — giving rung 0 a floor so its self-harm repair runs
when the deadline has gone — was built, measured and **refused**: §3.

Instruments: `--deadline-ms`, `--deadline-late`, `--deadline-jitter`,
`--host-slow`, `--score-traces` and `--rung0-floor` on the runner, and the
`anytime` block of `RunSummary`. Gate: `sum all 60 5 --nodes` byte-identical on
all 25 (scenario, seed) rows against the head this branch left.

---

## 1. The ladder: what a shrinking deadline costs, per class

`sum <class> 60 3 --nodes=N --score-traces`, deterministic node clock, three
seeds summed. `expired` is `--nodes=0`: `deadlineMs === t0`, so `budgetMs` is
zero and the refinement loop is never entered. `first slice` is `--nodes=16`,
the budget at which the loop completes about one slice — the slice count is
emergent (a slice ends when `improve()` returns, not when `sliceMs` does), so
the arm is named by the count it produces rather than by the length it asks
for.

`decs` is decisions the unbounded bank could price; `avoid` is answers it
floors at DEAD where moving ONE unit to another OFFERED option lifts it off
DEAD — the B0 floor already knowing what the answer costs.

| class | arm | deaths | meals | survivors | empty | unstaged | slices/dec | decs | fatal | avoid | avoid % |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **mixed** | expired | 16 | 47 | 8 | 0 | 0 | 0.00 | 414 | 25 | 13 | **3.1** |
| | first slice | 16 | 59 | 8 | 0 | 0 | 1.50 | 432 | 27 | 19 | **4.4** |
| | 0.125× | 14 | 102 | 10 | 0 | 0 | 5.62 | 444 | 8 | 1 | 0.2 |
| | 0.25× | 11 | 172 | 13 | 0 | 0 | 11.90 | 540 | 2 | 0 | 0.0 |
| | 0.5× | 10 | 187 | 14 | 0 | 0 | 22.20 | 498 | 5 | 0 | 0.0 |
| | **1×** | **6** | **234** | **18** | 0 | 0 | 42.88 | 540 | 0 | 0 | 0.0 |
| **potions** | expired | 14 | 31 | 10 | 0 | 0 | 0.00 | 539 | 19 | 15 | **2.8** |
| | first slice | 14 | 58 | 10 | 0 | 0 | 1.32 | 437 | 22 | 14 | **3.2** |
| | 0.125× | 12 | 134 | 12 | 0 | 0 | 5.41 | 496 | 16 | 3 | 0.6 |
| | 0.25× | 15 | 125 | 9 | 0 | 0 | 8.65 | 430 | 11 | 1 | 0.2 |
| | 0.5× | 11 | 185 | 13 | 0 | 0 | 27.56 | 487 | 3 | 0 | 0.0 |
| | **1×** | **6** | **224** | **18** | 0 | 0 | 70.90 | 540 | 2 | 0 | 0.0 |
| **snakes** | expired | 10 | 11 | 8 | 0 | 0 | 0.00 | 411 | 3 | 0 | 0.0 |
| | first slice | 7 | 144 | 11 | 0 | 0 | 3.04 | 500 | 2 | 0 | 0.0 |
| | 0.125× | 7 | 156 | 11 | 0 | 0 | 27.56 | — | — | — | — |
| | 0.25× | 7 | 152 | 11 | 0 | 0 | 71.37 | — | — | — | — |
| | 0.5× | 7 | 157 | 11 | 0 | 0 | 162.04 | — | — | — | — |
| | **1×** | **7** | **157** | **11** | 0 | 0 | 341.36 | 513 | 2 | 0 | 0.0 |
| **sparse** | expired | 6 | 3 | 6 | 0 | 0 | 0.00 | 360 | 0 | 0 | 0.0 |
| | first slice | 1 | 38 | 11 | 0 | 0 | 2.88 | 360 | 0 | 0 | 0.0 |
| | 0.125× | 2 | 48 | 10 | 0 | 0 | 30.52 | — | — | — | — |
| | 0.25× | 0 | 51 | 12 | 0 | 0 | 72.07 | — | — | — | — |
| | 0.5× | 0 | 52 | 12 | 0 | 0 | 161.29 | — | — | — | — |
| | **1×** | **0** | **52** | **12** | 0 | 0 | 340.84 | 360 | 0 | 0 | 0.0 |

(The four `—` rows on `snakes`/`sparse` were recorded before the per-decision
counters existed. Their per-unit-turn readings were 0 fatal and 0 avoidable,
which is what the rows above and below them say too, so nothing is hidden
there; they are marked rather than restated.)

### 1.1 The anytime property, in the two columns that are a contract

`empty` and `unstaged` are **0 in all 24 arms**, including the one where the
deadline had already gone. That is not luck and it is not the search being fast:
it is structural, and the structure is worth naming because every other number
here depends on it.

`drive` commits rung 0 BEFORE the loop, and rung 0 is
`conform(ctx, EMPTY_PLAN)`, which `search/core.ts` documents as *"the candidate
layer's ordered-first option for every unit, pins spliced in"* — a complete
legal plan by construction, not by search. The refinement loop's condition is
`while (run.now() < run.searchDeadline)`, so an expired deadline skips the loop
entirely and never touches the answer. And the ordered-first option is never a
rule-certain self-kill, because `staging-safety.ts` removes those at the
CANDIDATE layer, before any budget is consulted at all (`staging-safety.test.ts`,
the ORDERED claim).

So the answer at zero budget is: the same legal set the shipped bot would have
staged first, for every unit, with no board resolved and no slice run. The two
new suites in `src/lobster/__tests__/deadline-anytime.test.ts` drive exactly
that — on the stub rig for the clock arithmetic, and on a real `mixed` board
through the real search core for the roster claim.

### 1.2 The shape of the degradation

- **`sparse` and `snakes` degrade only at the very bottom.** `sparse` is 0
  deaths at 0.25× and above and 6 at expired; `snakes` is flat at 7 from the
  first slice up and 10 at expired. `BUDGET.md` §1 found these two classes
  *identical* from 0.5× to 4×; this extends that null downward and finds its
  edge: the budget is not connected to the behaviour on those boards until
  there is no budget at all, at which point the loss is the whole search.
- **`mixed` and `potions` degrade smoothly and steeply.** Deaths 6 → 16 and
  6 → 14, meals 234 → 47 and 224 → 31, survivors 18 → 8 and 18 → 10. The
  meal collapse is the sharper signal and it is monotone: a starved decision
  stops going anywhere, and `seedKept` runs at 99% where it runs at 49% at 1×.
- **The knee is between 0.25× and 0.5×** — 138 and 275 work units, which
  `BUDGET.md` §5's exchange rate puts at 37 and 75 ms. Above it, deaths are
  within 4–5 of the head and the B0 column is empty. Below it both move.
- **`potions` at 0.25× (15 deaths) is worse than at 0.125× (12).** Two arms
  three seeds apart on a class whose 1× reading is 6: this is the noise floor
  of a three-seed sum, and it is left in rather than smoothed because it is the
  honest width of every other cell in the table.

### 1.3 The B0 column, which is the one that is not just "worse play"

Deaths and meals degrading under a smaller budget is expected and `BUDGET.md`
already priced the top half of it. The `avoid` column is different in kind: it
says the kernel put a move on the wire that its OWN bank floors at DEAD, on a
board where moving one unit to another option the generator had already offered
would not have been.

It is **0.0% at 0.5× and 1× on every class**, 0.2–0.6% at 0.125–0.25×, and
2.8–4.4% at the two bottom arms. So it is not a defect that is always present
and merely rarer when there is budget; it is a defect that **appears** below
about a quarter of the shipped budget.

**And it is WORST at the first slice, not at zero.** 4.4% on `mixed` against
3.1% expired; 3.2% against 2.8% on `potions`. That inversion is the finding
underneath §3: at zero budget the kernel stages rung 0's seed, which the
candidate layer has already made non-suicidal; with one slice it moves OFF that
seed on the strength of bounds a single slice could not prove. **A little
budget buys a worse answer than none, by the deep bank's own reckoning.**

---

## 2. The wall-clock path under adversity

The runner's `ms` mode is production's deadline behaviour exactly —
`TeamDecisionEngine.kernelOptions()` ships `reserveMs: 40, sliceMs: 25`, and
the runner's `ms` branch sets the same two — so these arms read directly.

Three adversities, each a way a production deadline SHRINKS, and to a decision
all three are the same thing: fewer work units between `t0` and
`searchDeadline`.

- `--deadline-late=0.4` — the turn's `endTime` reached this host with 40% of
  the window already gone.
- `--deadline-jitter=0.3` — ±30% per decision, drawn from a stream of its own
  so a jittered run plays the same boards an unjittered one plays.
- `--host-slow=2` — the host does half as much work per millisecond, so the
  same wall-clock window buys half the work units (`BUDGET.md` §5's exchange
  rate read backwards).

`sum <class> 60 3 --deadline-ms=150`, three seeds. Overshoot is
`KernelReport.overshootMs` per decision; the p50/p95 are per game and the worst
game's is reported.

| class | arm | deaths | meals | surv | empty | unstaged | ovr p50 | ovr p95 | ovr max | elapsed p95 | nodes/dec |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **mixed** | 150 ms nominal | 11 | 205 | 13 | 0 | 0 | **0** | **0** | 62 | 130 | 249 |
| | late 40% | 11 | 130 | 13 | 0 | 0 | **0** | **0** | 118 | 74 | 93 |
| | jitter ±30% | 9 | 202 | 15 | 0 | 0 | **0** | **0** | 254 | 149 | 252 |
| | host ×2 slow | 14 | 144 | 10 | 0 | 0 | **0** | **0** | 157 | 69 | 86 |
| | all three | 18 | 44 | 6 | 0 | 0 | **0** | 61 | 89 | 103 | 9 |
| **potions** | 150 ms nominal | 11 | 213 | 13 | 0 | 0 | **0** | **0** | 115 | 130 | 262 |
| | late 40% | 10 | 164 | 14 | 0 | 0 | **0** | **0** | 202 | 74 | 94 |
| | jitter ±30% | 11 | 225 | 13 | 0 | 0 | **0** | **0** | 115 | 151 | 260 |
| | host ×2 slow | 12 | 151 | 12 | 0 | 0 | **0** | **0** | 33 | 52 | 98 |
| | all three | 18 | 35 | 6 | 0 | 0 | **0** | **0** | 72 | 34 | 13 |

### 2.1 The margin: `deadlineFromWallClock` plus the reserve carve holds

**Overshoot is zero at the median AND at the 95th percentile on every single
arm but one.** A nominal 150 ms decision spends about 100 ms of a 110 ms search
window (150 − the 40 ms `reserveMs`) and stops: the margin is real and it is
about 50 ms wide. Under a 40%-late `endTime` the window is 90 ms, the search
takes ~55, and the p95 overshoot is still 0. Under a 2×-slow host the same.

Only the three adversities TOGETHER — a ~45 ms mean window, which is a third of
one production slice — push the p95 to 61 ms on `mixed`, and by then the
decision is rung 0 and nothing else (9 work units against 249 nominal).

**The maxima are the machine, not the policy.** 33–254 ms, on a container
shared with eight other workers. The same command run twice on this host gave
an overshoot max of 174 ms on one pass and 0 on the next, with `worstDecisionMs`
moving 445 → 150; `ux/03-LATENCY.md` §2 measured the same ±50% spread on its own
canvas span and drew the same conclusion. No claim is made from a maximum here.
The p50/p95 columns are the reading.

### 2.2 What a decision costs when there is NO window: rung 0, timed

`--deadline-ms=0` gives `budgetMs = 0`, so `searchDeadline` is `t0 − 40`, the
loop is never entered and `elapsedMs === overshootMs` is rung 0's own cost and
nothing else. `mixed`, 30 turns, seeds 1 and 2:

| | p50 | p95 | max |
|---|---:|---:|---:|
| rung 0 alone, ms | **7.6 / 14.7** | **55.4 / 64.8** | **113.5 / 105.9** |

**This is the floor on how late an answer can possibly be, and no deadline
policy can lower it.** Rung 0 generates and assesses every unit's candidate set
and pays one `price()`, and `kernel.ts` names why it cannot be bounded: on the
first decision of a game it also pays the whole grammar warm-up the reach
shells memoise per game. A decision handed an already-dead deadline answers
8 ms later at the median and 114 ms later at its worst.

It still fits. The wire holds back 150 ms (`MIN_RESERVE_MS`) and the kernel a
further 40, so an answer has 190 ms of margin ahead of `endTime` before a
staged write is discarded — and rung 0's worst observed cost is 114.

### 2.3 The lens's inspection reserve is never taken on credit

The question `carveReserve` has to answer is whether an operator who may not be
watching can make a starved decision starve further. It cannot, and the guard
is explicit: the carve happens only when `searchDeadlineMs - nowMs >
LENS_INSPECTION_MS * 2` — strictly more than 40 ms of window for a 20 ms
reserve. Below that the reserve is 0 and the search keeps its whole window.

`decide` reaches it with `searchDeadlineMs = deadline - reserveMs` and
`nowMs = t0`, so the available quantity IS the decision's own budget less the
flush reserve. At `budgetMs = 0` it is −1 and the carve declines; the tests
pin the boundary at exactly `2 × LENS_INSPECTION_MS` and pin the negative case
too. Driven end to end: a watched decision at an expired deadline runs the same
number of slices as an unwatched one and reports the same lateness.

So: **no.** The inspection reserve is only ever carved from a window that could
afford twice it, and that was true before this branch — the finding is that it
is now checked at the boundary rather than in the middle of its range.

---

## 3. The rung-0 floor: built, measured, refused

§1.3 named the mechanism. Rung 0 pays for one `price()` and then READS it: the
self-harm repair (`search/core.ts`, `repairSelfHarm`) re-picks any of our own
units the resolution names as a casualty of our own plan. But that repair is a
budget-watching loop like every other — `climb` breaks on
`budget.shouldStop()` on its first test — and `conformNow` builds its budget
from `run.searchDeadline`. With the deadline already gone, `shouldStop()` is
true immediately, **the repair does nothing, and the kernel stages a cell it
has just proved fatal.**

So the obvious fix: give rung 0, and rung 0 only, a floor —
`max(searchDeadline, now + rungZeroFloorMs)` — so the repair has a window even
when the search does not. Twelve work units, which is the ~3 ms a repair costs
read through `BUDGET.md` §5's exchange rate.

**It does not work.** `--nodes=0 --rung0-floor={0,12}`, `mixed` and `potions`,
seeds 1–3, sixty turns:

| class | floor | deaths | meals | surv | priced decs | fatal | avoidable | avoidable % | nodes/dec |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| mixed | 0 | 16 | 47 | 8 | 414 | 25 | 13 | **3.1** | 2.00 |
| mixed | 12 | 14 | 43 | 10 | 475 | 28 | 22 | **4.6** | 8.53 |
| potions | 0 | 14 | 31 | 10 | 539 | 19 | 15 | **2.8** | 2.00 |
| potions | 12 | 15 | 32 | 9 | 448 | 25 | 21 | **4.7** | 7.39 |

Deaths 30 → 29 over twelve games, which is a wash; meals a wash; and the
quantity the floor was built to lower goes UP on both classes, 3.1 → 4.6% and
2.8 → 4.7%, for four times the work.

**The reason is that the repair's bank is starved too.** `climb` accepts a
re-pick on `better()`, which compares proved floors — and the floor it compares
was priced by a bank that a stopped budget stopped. So the repair optimises
against a bound it could not afford to compute, and lands on plans the
unbounded bank calls DEAD more often than the seed it started from. It is the
same inversion §1.3 found between the expired arm and the first-slice arm,
reproduced deliberately: **a little budget spent on safety buys a worse answer
than none, and time you do not have cannot be spent on safety.**

`KernelOptions.rungZeroFloorMs` therefore ships at **0**, and `--rung0-floor=N`
on the runner is the arm that recorded this. At 0 the floor expression is not
evaluated at all — `run.now()` charges a read on the node clock and a read is
work — so the shipped kernel is bit-for-bit the kernel that existed before it.

The real conclusion is a policy one and it is §4: the fix for a deadline too
small to be safe in is **not letting the deadline get that small**.

---

## 4. Holes found, and what was done about each

The brief named four classes. Measured:

| hole | found? | what was done |
|---|---|---|
| **no answer** | **No.** 0 empty decisions in 24 node-clock arms and 10 wall-clock arms, expired deadlines included. | Pinned: `deadline-anytime.test.ts` drives `decide` at an expired deadline, at a window shorter than one slice, and at exactly zero, on the stub rig and on the real core. |
| **an illegal answer** | **No.** 0 unstaged units in the same 34 arms; every answer names the whole live roster. | Pinned, same suite: the real-core cases compare the staged key set against the team's live ids at budgets 0, −50, 1, 16 and 275. |
| **a fatal fallback with a safe alternative** | **Yes, below ~0.25× budget** — 3.1% (`mixed`) and 2.8% (`potions`) of answers at an expired deadline, 0.0% at 0.5× and above. | The obvious repair was built and **refused** (§3): it makes the number worse. Closed instead by §4.1's policy, and instrumented so a regression is visible: `RunSummary.anytime`. |
| **a late answer under a modest late `endTime`** | **No, in the wall clock** — p50 and p95 overshoot are 0 under a 40%-late `endTime`, ±30% jitter and a 2×-slow host. **Yes, in the reporting**: the kernel could not say it. | Fixed (§4.2). |

### 4.1 The policy that closes the third row: `MIN_COMPUTE_MS` is load-bearing

`wire/deadline.ts` floors the decision window at `now + 200` and calls the
constant *"the legacy `Date.now() + 200` term"*, kept *"verbatim"*. §1 prices
it. 200 ms is ~740 work units by `BUDGET.md` §5's rate — above 1× — and the
avoidably-fatal column is empty from 275 work units (75 ms) upward on every
class. **The floor is not legacy. It is the whole of what stands between
production and the 3% column, and it must not be lowered or removed.**

`effectiveDeadlineMs` can only move the deadline EARLIER (a widened 3σ reserve,
a provably slow host clock), so `now + 200` is the only term in the expression
that ever pushes back, and it is the term the measurement now depends on.

### 4.2 The two fixes: the kernel can say how late it was

Both are report-only. Neither changes how a decision is made at any budget, and
the byte-identity gate is the proof.

**(i) `overshootMs` was measured against a deadline the kernel had moved.**
`decide` computes `budgetMs = max(0, deadlineMs − t0)` and then
`deadline = t0 + budgetMs` — so a deadline already in the past is silently
rewritten to "now". The clamp on `budgetMs` is right and stays: the
affordability guard and the slice cap are fractions of it and must not go
negative. But `overshootMs = max(0, end − deadline)` then read against the
MOVED deadline, and a decision entered 300 ms late and taking 100 ms reported
`overshootMs: 100` while nothing anywhere said 400. It is now measured against
`input.deadlineMs`, which is what the wire actually asked for and what the
operator's notch is set from.

**(ii) Nothing could observe a decision entered with no budget.**
`KernelReport.startedLateMs` is `max(0, t0 − deadlineMs)`, and
`TeamDecisionEngine` logs it. This is a WIRE condition and it is invisible from
inside a game: `effectiveDeadlineMs` floors at `now + 200`, but the floor is
taken when the turn snapshot is read, and the substrate build, the bot binding,
the lens sink and every other game sharing the process are all spent out of the
same 200 ms. `liveBudgetMs` on the lens's stored input already existed because
somebody suspected this; now the condition itself is named where an operator
can grep for it.

---

## 5. The recommended production policy

1. **Keep `MIN_COMPUTE_MS = 200`, and treat it as a safety floor rather than a
   legacy constant.** §4.1. If it is ever made configurable, its minimum is
   275 work units — 75 ms on a `mixed`-shaped board — below which the
   avoidably-fatal column stops being empty.
2. **Keep `reserveMs: 40` in the kernel and `MIN_RESERVE_MS = 150` on the
   wire.** The pair gives 190 ms of margin ahead of `endTime`, and the worst
   rung-0 cost observed here is 114 ms. Overshoot is 0 at the p95 on every
   adversity arm; the reserve is doing its job and is not oversized enough to
   be worth trimming, because trimming it buys budget on the plateau
   (`BUDGET.md` §6) and spends margin at the cliff.
3. **Instrument `startedLateMs`, not `effectiveDeadlineMs − now`.**
   `BUDGET.md` §6 asked for the distribution of the window; the sharper
   question is how often the window is GONE by the time the kernel sees it,
   because that is the only state in which no search quality can help. The line
   is in `TeamDecisionEngine`'s `finally` and costs nothing when it never fires.
4. **A turn window under ~500 ms should be treated as a product decision, not a
   tuning one.** At 500 ms production sits at ~2× (`BUDGET.md` §5). A 40%-late
   `endTime` plus a 2× slow host takes that to ~0.3×, which §1 prices at
   +4 deaths and −60 meals per three seeds; all three adversities together take
   it to ~0.1×, which is rung 0 and costs 3× the deaths.
5. **Do not spend a starved decision's last milliseconds on safety.** §3. If a
   future worker reaches for the same repair, the arm is `--rung0-floor=N` and
   the answer is already recorded.

### 5.1 What the operator's notch should assume

`ux/03-LATENCY.md` §3 builds the last-safe-press notch at
`deadline − (RTT/2 + server work)`. This measurement says what "server work"
has to be:

- **Not the reserve.** 150 + 40 ms is what protects the WRITE, and a pin
  arriving inside it is not late for the write — it is late for the SEARCH,
  which is a different and earlier moment.
- **The last slice boundary.** The kernel drains queued operator events between
  slices, so the last moment a pin can open an epoch is the start of the final
  slice: `endTime − 190 − (one slice)`. One production slice is `sliceMs: 25`
  grown to 5× the measured cost and capped at 0.1 × budget, so on a 350 ms
  window the cap is 35 ms. **The notch should sit at `endTime − 225 ms −
  RTT/2`, not at `endTime − 150 − RTT/2`.**
- **And it collapses when the decision started late.** A decision with
  `startedLateMs > 0` runs rung 0 and stops: there is no slice boundary after
  it, so no pin can be drained at all, and the last-safe-press moment for that
  turn was ~65 ms (p95) to 114 ms (worst) before the kernel even began. The
  surface cannot predict this — it is a wire condition — but it CAN read it:
  `gameLagMs` on `board-update` is the same fact one hop earlier, and the notch
  should widen when it is large rather than staying where a healthy turn puts
  it.

---

## 6. Settled here, in one place

- The anytime property holds at every cutoff measured, an already-expired
  deadline included: 0 answers with no record, 0 answers missing a live unit,
  in 34 arms across two clocks. It is structural — rung 0 is
  `conform(ctx, ∅)`, committed before the loop, and the candidate layer has
  already removed the rule-certain self-kills.
- Play degrades smoothly on `mixed` and `potions` (deaths 6 → 16 and 6 → 14,
  meals 234 → 47 and 224 → 31 from 1× to expired) and only at the very bottom
  on `snakes` and `sparse`.
- The knee is between 0.25× and 0.5× — 37 to 75 ms.
- Answers the bank's own floor calls DEAD with a one-unit fix available:
  0.0% at 0.5× and 1×, 2.8–4.4% at the two bottom arms, and **worst at the
  first slice rather than at zero**.
- `deadlineFromWallClock` plus the reserve carve keeps the answer inside the
  deadline: overshoot p50 and p95 are 0 under a 40%-late `endTime`, ±30%
  jitter, and a host twice as slow. Maxima are container load and no claim is
  made from them.
- Rung 0 alone costs 8 ms (p50) / 65 ms (p95) / 114 ms (worst) and cannot be
  bounded. It is the floor on how late any answer can be, and it fits inside
  the 190 ms the wire and the kernel reserve together.
- The lens's 20 ms inspection reserve is never carved from a window that cannot
  afford twice it, expired deadlines included.
- Giving rung 0's self-harm repair a floor was built, measured and refused: the
  repair's own bank is starved, so it optimises against a bound it cannot
  compute and makes the answer worse. `rungZeroFloorMs` ships at 0.
- `MIN_COMPUTE_MS = 200` is the mechanism that keeps production out of the
  region where any of this matters.

Recordings under `<scratchpad>/dl/{pre,lad,ab,wall}` (this container).
Reproduce with
`node dist/tests/local-game.js sum <class> 60 3 --nodes=<N> --score-traces --json=F`
and
`node dist/tests/local-game.js sum <class> 60 3 --deadline-ms=150 [--deadline-late=0.4] [--deadline-jitter=0.3] [--host-slow=2] --json=F`.
