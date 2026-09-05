# BUDGET — the marginal value of search budget

The `budget` row of `docs/ORCHESTRATOR-LOOP.md`. The question: a decision gets
550 work units. Is that the right number, does the answer depend on the board,
and if it depends on the board should the split be uneven?

**The answer is a null with a sharp edge.** From 1× to 4× the budget buys
nothing on any class — on two classes it changes not one decision in an
eightfold range, and on the other two it changes a fifth of them without ever
improving an outcome. Below 1× it costs real food and real lives. The head's
550 is a deaths-local-minimum in BOTH directions, and no allocation rule is
merged.

Instruments: `--budget-scale` and `--probe` on the runner (`fb49e1e`, and the
flags' own docstrings in `src/tests/local-game.ts`). Recordings:
96 outcome games (4 classes × seeds 1–6 × {0.5, 1, 2, 4}× at 60 turns) and
12 probe games (4 classes × seeds 1–3 at 30 turns, 990 decisions, each one
re-decided on its own board at each scale).

---

## 1. Outcomes: 96 games, four classes, four budgets

60 turns, seeds 1–6, deterministic node clock, everything else the head.
Deaths and meals are the six-seed sums.

| class | | 0.5× (275) | 1× (550) | 2× (1100) | 4× (2200) |
|---|---|---:|---:|---:|---:|
| **mixed** | deaths | 19 | **14** | 24 | 16 |
| | meals | 372 | 446 | 441 | 460 |
| | fatal entrapments | 6 | 5 | 12 | 6 |
| | survivors | 29 | 34 | 24 | 32 |
| **potions** | deaths | 22 | **14** | 18 | 22 |
| | meals | 371 | 462 | 454 | 476 |
| | potion pickups / reckless | 27 / 18 | 28 / 19 | 29 / 22 | 24 / 19 |
| | fatal entrapments | 10 | 6 | 6 | 12 |
| **snakes** | deaths | 16 | 16 | 16 | 16 |
| | meals | 317 | 317 | 317 | 317 |
| **sparse** | deaths | 0 | 0 | 0 | 0 |
| | meals | 101 | 101 | 101 | 101 |

**`snakes` and `sparse` are not approximately equal across the range — they are
identical.** Every counter, every rate and every `deathsByCause` entry, on all
six seeds, at 275 and at 2200 work units. Twenty-four games each, an eightfold
budget range, zero bits of difference. The budget knob is not connected to
anything on those boards.

Deaths by cause, where they move at all:

| | 0.5× | 1× | 2× | 4× |
|---|---|---|---|---|
| mixed | contest 18, edge 1 | contest 11, bodyBlock 2, self 1 | contest 15, bodyBlock 4, edge 3, self 1, wall 1 | contest 9, bodyBlock 4, edge 1, self 1, wall 1 |
| potions | contest 18, bodyBlock 1, edge 3 | contest 12, bodyBlock 2 | contest 8, bodyBlock 7, edge 3 | contest 13, bodyBlock 4, edge 3, self 2 |

A cheaper decision dies of `contest` — it stakes a cell it cannot hold. A
richer one dies of `bodyBlock` and `edge` — it finds a longer plan and walks
into its own body or the wall at the end of it. Neither is safer; they are
different deaths.

## 2. The paired sign test, per class

Each seed is a matched pair: the same board, the same generator, one budget
apart. The units are per-seed deaths at 60 turns.

| arm vs 1× | mixed | potions | snakes | sparse |
|---|---|---|---|---|
| 0.5× deaths | worse 3, better 0, tied 3 (p=0.25) | worse 5, better 0, tied 1 (p=0.062) | tied 6 | tied 6 |
| 0.5× meals | fewer 6, more 0 (**p=0.031**) | fewer 6, more 0 (**p=0.031**) | tied 6 | tied 6 |
| 2× deaths | worse 4, better 0, tied 2 (p=0.125) | worse 4, better 0, tied 2 (p=0.125) | tied 6 | tied 6 |
| 4× deaths | worse 2, better 2, tied 2 (p=1.0) | worse 5, better 0, tied 1 (p=0.062) | tied 6 | tied 6 |

Pooled over the two classes that move at all (mixed + potions, 12 seeds each
arm):

- **more budget than 1× (2× and 4× together): worse 15, better 2, tied 7 — p = 0.0024.**
  The significant direction is the wrong one. Not one arm on not one class is
  better than the head on deaths at any conventional level; the only effect
  that clears a threshold is that MORE budget is worse.
- **half the budget: deaths worse 8, better 0, tied 4 (p = 0.0078); meals fewer
  on 12 of 12 seeds (p = 0.0005).** The floor is real.

**The marginal-value curve, per class.** Value rises steeply from 0.5× to 1×
(mixed −5 deaths and +74 meals, potions −8 deaths and +91 meals), is flat to
negative from 1× to 4× on those two, and is exactly zero everywhere on `snakes`
and `sparse`. The head sits on the knee.

## 3. Which decisions move, and what the shape of a movable decision is

The outcome runs cannot say WHICH decisions moved: two arms diverge on the
first disagreement and every position after it is a different game. The probe
fixes the board — the game advances on the 1× decision, and at every
`(turn, team)` the SAME position is decided again at each scale — so a row
compares choices rather than boards. 990 decisions with a complete set of arms.

Every feature below is a function of the board BEFORE the search starts, which
is what an allocation rule would have to read.

**Contact — our units whose influence meets a live enemy's — is the axis.**

| contact | n | x0.5 | x2 | x4 |
|---:|---:|---:|---:|---:|
| 0 | 228 | 0.0% | 0.0% | 0.0% |
| 1 | 366 | 6.3% | 2.7% | 3.0% |
| 2 | 315 | 28.9% | 21.0% | 22.2% |
| ≥3 | 81 | 37.0% | 35.8% | **46.9%** |

**The joint candidate product is the second.** (`Π candidates` over the free set.)

| product | n | x0.5 | x2 | x4 |
|---:|---:|---:|---:|---:|
| 2–24 | 626 | 7.5% | 3.4% | 3.5% |
| 25–512 | 359 | 26.7% | 23.4% | 27.0% |

Cluster size and candidate count say the same thing more weakly — biggest
cluster 1 → 7.4% at 4× against 25.7% at size 3; `candSum` under 5 → 0.0%,
10–19 → 32.8%; three commandable units → 29.9% against 4.4% for two. All four
features are the same underlying quantity: **how entangled this team's units
are with each other and with a live enemy.**

**Half of all decisions are provably budget-insensitive by a board-only test.**
Take the quiet set to be `contact ≤ 1 AND product < 25`:

| set | n | share | changed at 0.5× | at 2× | at 4× |
|---|---:|---:|---:|---:|---:|
| quiet | 485 | 49.0% | 1.4% | **0.0%** | **0.0%** |
| rest | 505 | 51.0% | 27.1% | 20.8% | 23.6% |

Per class the quiet share is `snakes` 92.6%, `sparse` 91.1%, `potions` 21.1%,
`mixed` 5.2% — which is the whole of §1's identity result, restated as a
property of the decisions rather than of the games.

**Are 4× choices safer? No — they are different, and their differences do not
survive contact with the outcome.** 22% of `mixed` and `potions` decisions move
at 4×, by a median of one unit's staged cell. §2 measures what happens when
every one of them moves: deaths worse on 7 of 12 seeds, better on 2, and the
causes rotate from `contest` toward `bodyBlock`/`edge`. A move that a bigger
search prefers is a move a longer plan justifies, and this bot's evaluator
prices the end of a longer plan no better than the end of a short one.

**Where the extra budget goes.** Mean nodes actually spent against the budget
offered:

| class | 0.5× | 1× | 2× | 4× |
|---|---:|---:|---:|---:|
| mixed | 227/275 = 0.83 | 419/550 = 0.76 | 653/1100 = 0.59 | 902/2200 = **0.41** |
| potions | 222/275 = 0.81 | 403/550 = 0.73 | 638/1100 = 0.58 | 929/2200 = **0.42** |
| snakes | 191/275 = 0.70 | 366/550 = 0.67 | 715/1100 = 0.65 | 1414/2200 = 0.64 |
| sparse | 191/275 = 0.70 | 367/550 = 0.67 | 716/1100 = 0.65 | 1417/2200 = 0.64 |

(The ratio is below 1 at every scale because the clock also charges reads:
`nodes × NODE_COST + reads × READ_COST`.) Two different mechanisms produce one
null. On `mixed` and `potions` the fresh-evaluation share COLLAPSES as the
budget grows — at 4× the search stops finding plans it has not already priced
and the affordability guard (`guardBudgetFraction` 0.2, `stepSafetyFactor` 1.6)
retires the decision with the rest unspent. On `snakes` and `sparse` the ratio
is flat: those decisions spend the whole clock at every scale, slice after
slice, and stage the identical set anyway.

This is `DEFAULT_NODE_BUDGET`'s own docstring extended by a factor of four.
It says fresh evaluation saturates above 600 — *"past that point the marginal
unit buys re-pricing of plans the bank has already priced and nothing else."*
The measurement here says the same thing at 2200 and adds the outcome the
docstring could not: the re-pricing does change a fifth of the choices on the
crowded classes, and those changes are not worth having.

It is also `08-DEPTH-VERDICT.md` §1.3 read on a different axis. There,
affordability is anti-correlated with value — the 34% of occasions a deeper
ply could pay for are exactly the ones B3 already closed exactly. Here, the
decisions with budget to spare are exactly the quiet ones with nothing to spend
it on, and the entangled ones that could use it are the ones where four times
as much still is not enough to change the answer's quality.

## 4. The allocation rule: not merged, and why

The rule the row asked for is a per-decision budget share read off observable
complexity, with the turn total held equal — spend the quiet half's budget on
the entangled half. §3 gives it a clean selector: `contact ≤ 1 AND product < 25`
is 49% of decisions and 0.0% of them change anywhere in 0.5×–4×.

**It is not merged, and the reason is a bound rather than a failed A/B.**

1. **The upside is bounded at zero by an arm already run.** Any equal-total
   reallocation can only enrich decisions that are already in the movable set,
   and the richest thing it can do to them is bounded by giving every decision
   4×. That arm exists: §2, deaths better on 0 of 24 (class, seed) pairs and
   worse on 15, p = 0.0024 in the wrong direction. A rule that moves a SUBSET
   of those decisions cannot beat moving all of them unless it selects the
   beneficial ones — and the board-only features that select movable decisions
   (contact, product, cluster size, candidate count) are the ones already used
   to define the set, so there is nothing left in them to select WITH.
2. **The downside is measured and real.** Every equal-total rule takes budget
   from somewhere, and the 0.5× arm prices that: fewer meals on 12 of 12 seeds
   (p = 0.0005) and more deaths on 8 of 12. The quiet set's 1.4% change rate at
   0.5× says the taking would be nearly free on the classes measured — but
   "nearly" is doing work on a 990-decision sample, and it is being traded for
   a gain bounded above by zero.
3. **The gate could not be passed even in principle.** The row's gate asks that
   *the changed decisions are the ones the curve said matter*. The curve says
   the decisions that matter are the ones where extra budget changes the choice
   AND the change is an improvement. The second conjunct has an empty extension
   on this corpus.
4. **The kernel has no turn to hold equal.** `LobsterKernel.decide` receives one
   absolute `deadlineMs` and derives `budgetMs = max(0, deadlineMs − t0)` from
   it (`kernel.ts`, `decide`). It sees one decision; it has no ledger across the
   decisions of a turn and no way to acquire one without becoming stateful
   across games. The kernel's own budget split — `reserveMs` for the final
   flush, then `carveReserve` for the operator's inspection reserve, then slices
   against `searchDeadline` — is a split WITHIN one decision. An equal-total
   rule across decisions is the CALLER's, and in production the caller takes one
   decision per turn (`team-decision-engine.ts`), so its turn total is one
   decision's budget and there is nothing to reallocate at all. The uneven
   split only exists in the runner, where a game has several teams.

So: `kernel.ts` is unchanged, and this document is the deliverable.

**What the data would support, if the loop ever wants it, is the other
direction: a cheapness rule, not an enrichment rule.** Give a decision with
`contact ≤ 1 AND product < 25` half the budget and keep the rest. On this
corpus that is byte-identical on 2× and 4× and 1.4% changed at 0.5×, and it
would return roughly a quarter of the corpus's total search cost. It buys wall
time and not deaths, so it is not admissible under the standing rules as
stated, and it would need re-measuring under the `ms` clock (where the saving is
the point) before anyone leaned on it. It is recorded here so that the next
worker to ask "can we go faster" does not have to re-run 108 games to find the
selector.

## 5. How the wall-clock deadline maps onto nodes in production

The study is run under the node clock, which is not the clock production runs.
The chain, in order, so the arms can be read as milliseconds:

1. **The server stamps `endTime`** on the turn document from its own clock.
2. **`TurnDeadlineGuard.effectiveDeadlineMs`** (`src/wire/deadline.ts`) turns it
   into a local deadline: `max(now + 200, endTime − max(150, 3σ) + min(0, meanLag))`.
   σ is the EWMA standard deviation of arrival lag and `meanLag` corrects only a
   PROVABLY slow host clock, so every correction moves the deadline earlier.
   With no observations it reproduces the legacy `max(now + 200, endTime − 150)`
   exactly.
3. **`deadlineFromWallClock`** (`kernel.ts`; called at
   `team-decision-engine.ts:632`) converts that `Date.now()`-based absolute onto
   the kernel's monotonic clock ONCE — `now() + (absolute − Date.now())`. Mixing
   the two scales is the clock-skew bug this exists to prevent.
4. **`decide`** takes `budgetMs = max(0, deadlineMs − t0)`, holds back
   `reserveMs = 1` for the final flush, and — only when a lens is attached —
   carves `LENS_INSPECTION_MS = 20` on top of that (`carveReserve`). A decision
   nobody inspects is exactly as long as it was before the lens existed. What
   remains is `searchDeadline`.
5. **Slices** run against it: floor `sliceMs` 0.5, grown to 5× the measured
   slice cost, capped at `maxSliceFraction` 0.1 of the budget; a further slice
   starts only while the remaining budget exceeds `min(estimate × 1.6,
   0.2 × budget)`.

**The exchange rate.** `DEFAULT_NODE_BUDGET`'s docstring is the measurement:
a 150 ms decision on `mixed` spends 414–662 work units, median 596, and 550 was
chosen just under that because fresh evaluation saturates above 600. So **1 ms
≈ 3.7 work units**, and the arms of this study are:

| arm | work units | ≈ production ms |
|---|---:|---:|
| 0.5× | 275 | ~75 ms |
| 1× | 550 | ~150 ms |
| 2× | 1100 | ~300 ms |
| 4× | 2200 | ~600 ms |

The rate is a per-board constant, not a universal one — it is nodes plus a
hundredth of the reads, and a wider board reads more per node — so treat it as
the mapping for `mixed`-shaped play and not as a conversion factor to be
applied elsewhere.

**What this means for production.** A turn window of 500 ms leaves ~350 ms after
the standing 150 ms reserve, minus 1 (and 20 when someone is watching) — about
1200 work units, a little over 2×. **Production already sits on the plateau, and
possibly past its knee.** Two consequences, and they are the whole practical
content of this document:

- **There is nothing to buy at the top.** Making decisions faster, or the server
  window longer, will not lower deaths. `08-DEPTH-VERDICT.md` §7 reached the
  same wall from the other side and named the escape as *"a budget an order of
  magnitude larger"*; 4× is not that, and this measurement says a factor of four
  is inside the flat part of the curve.
- **The danger is entirely at the bottom, and it is a wire risk rather than a
  search one.** The floor that hurts is somewhere between 275 and 550 work units
  — 75 to 150 ms. `effectiveDeadlineMs` can reach it: a jittery link widens the
  reserve to 3σ and a provably slow host clock subtracts its skew, both without
  a decision being made badly anywhere. The `now + 200` floor is what stands
  between that and the 0.5× column, and the 0.5× column costs meals on 12 of 12
  seeds. **If any budget work follows this document, it is instrumenting the
  distribution of `effectiveDeadlineMs − now` in real games — not enlarging it.**

## 6. Settled here, in one place

- The head's 550 is a deaths-local-minimum in both directions on this corpus.
- 4× ≈ 1× on outcomes, and the only significant effect of moving the budget UP
  is that deaths go up (p = 0.0024, 24 paired seeds).
- `snakes` and `sparse` are counter-for-counter identical from 0.5× to 4× on
  all six seeds: on those boards the budget is not connected to the behaviour.
- 49% of decisions are budget-insensitive by a board-only test (`contact ≤ 1 AND
  product < 25`), 0.0% changed at 2× and 4×.
- Of the decisions that DO move — contact ≥ 2, product ≥ 25 — a fifth move at
  4×, by about one unit's cell, and the move is not an improvement: the deaths
  rotate from `contest` to `bodyBlock`/`edge` and do not fall.
- No allocation rule is merged. The upside is bounded at zero by an arm already
  run, the downside is measured, and the kernel has no turn total to hold equal:
  in production one turn is one decision.
- Production's window maps to ~2× at a 500 ms turn. The risk is a deadline that
  shrinks below ~150 ms, not one that fails to grow.

Recordings: 108 games under
`/tmp/.../scratchpad/budget/{out,probe}` (this container). Reproduce with
`node dist/tests/local-game.js sum <class> 60 6 --nodes --budget-scale=X --json=F`
and `node dist/tests/local-game.js <class> 30 <seed> --nodes --probe=F
--probe-scales=0.5,2,4`.
