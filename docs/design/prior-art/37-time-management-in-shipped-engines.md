# PRIOR ART 37 — time management in shipped engines: C8's second factor, twice implemented

Domain 2's **C8** is the survey's oldest open item. Russell & Wefald: a
computation is worth its cost only if it can **change the chosen action**, so the
hypothesis market's score needs `P(refinement flips better())` — and the survey
could say what the quantity was but not how anyone computes it.

Two engines compute it. They compute it **differently**, they both ship it, and
both implementations are free — counters over work the search has already done.
Neither needs the interval arithmetic C8 proposed, though one of them is exactly
that.

This is the practitioner half of domain 2, read against `timeman.cpp` and
`search.cpp` at source, and against the TIME lens's compiled v0 CPPs.

---

## 37.1 Answer one: a base budget times four stability multipliers

**S65. Stockfish, `src/timeman.cpp` and `src/search.cpp` (master).** Every
constant below is a source literal tuned by SPRT on the distributed test
framework; none is exposed as a user option.

**The base, set once per move** (`TimeManagement::init`). Two bounds, not one:

    optimumTime = optScale * timeLeft
    maximumTime = min(0.8097 * timeRemaining − overhead, maxScale * optimumTime)

with `optScale = min(0.012112 + (ply + 3.22713)^0.46866 * optConstant, …)` and
`maxScale = min(6.873, maxConstant + ply/12.352)` where `maxConstant ≥ 3.1441`.

  So the engine ships a **soft target and a hard ceiling between roughly 3× and
  6.9× larger**, and the per-move budget grows sub-linearly in `ply` (exponent
  0.46866).

  And the one line that states an economy:

    if (options["Ponder"]) optimumTime += optimumTime / 4;

  **Pondering does not reserve time; it makes the current move 25% more
  expensive**, because the free compute will refund it later.

**The in-search adjustment, recomputed every iteration** (`search.cpp` ~571–613).
The soft target is multiplied by four independent factors:

| factor | what it reads | range |
|---|---|---|
| `fallingEval` | `2.30·(previous move's average score − current best) + 1.1·(the score 4 iterations ago − current best)` | clamped **[0.576, 1.728]** |
| `reduction` | `(1.468 + previousTimeReduction) / (2.284 · timeReduction)`, where `timeReduction` interpolates on **`rootDepth − lastBestMoveDepth`** (iterations the best move has been stable), 4.96→18.79 mapping to 0.639→1.712 | clamped [0.629, 1.544] |
| `bestMoveInstability` | `1.077 + 2.229 · bestMoveChanges / threads` | unbounded above |
| `highBestMoveEffort` | fraction of all nodes spent under the *current best root move*, 75.8%→100% mapping to 0.969→0.714 | clamped [0.693, 0.838] |

    totalTime = optimum * fallingEval * reduction * bestMoveInstability * highBestMoveEffort
    if (elapsed > min(totalTime, maximum) || score >= mate_in(3)) stop;
    else increaseDepth = ponder || elapsed <= totalTime * 0.50;

Four decisions worth naming, because each is a design choice and not an accident:

1. **The signals are asymmetric in direction.** `fallingEval`'s two terms are both
   positive when the score is *dropping*. **Bad news is worth more computation
   than good news**, at a measured span of 3× (0.576 to 1.728). A symmetric
   "uncertainty" measure would not do this.
2. **Stability is measured over two horizons and carried across moves.** Within
   the search: how many iterations since the best move last changed, and how many
   times it changed this iteration. Across moves: `previousTimeReduction` feeds
   the current move's `reduction`, under the comment *"use part of the gained time
   from a previous stable move for the current move"*. The eval trend uses a
   **4-slot ring buffer**, comparing against the value four iterations ago rather
   than the last one.
3. **Effort concentration is a stopping signal.** If most of the search's nodes
   went into the move it is going to play anyway, it stops earlier
   (`highBestMoveEffort` falls to 0.693). That is a *distributional* read of the
   same question — not "has the answer changed" but "is the search still
   considering alternatives".
4. **Don't start what you cannot finish.** Past 50% of the adjusted budget, new
   iterations are not begun. An iteration is a **contract** algorithm in
   Zilberstein's sense; starting one you will interrupt wastes it.

And **`nodestime`**: an option that replaces the wall clock with a node counter
("nodes as time"), so that a timed game is deterministic and machine-independent —
shipped, with a warning that the assumed nodes-per-millisecond must be well below
real engine speed.

---

## 37.2 Answer two: a sufficiency condition, with two guards

**S66. Leela Chess Zero, "smart pruning" (`SmartPruningFactor`, default **1.33**;
`SmartPruningMinimumBatches`).** The rule: *stop spending on moves that cannot
become the best move given the remaining budget*, and stop the search entirely
when no remaining move can overtake the leader.

This is **C8's factor computed exactly rather than estimated** — a soundness
condition of the form *the remaining refinement cannot flip the argmax*, which is
an interval query, not a heuristic.

The two guards are the interesting part, because they are what the pure condition
needs to be usable:

- **`SmartPruningFactor` defaults above 1** (1.33): values >1 stop less-promising
  moves *earlier than the provable condition allows*, values <1 leave hopeless
  moves some attention. The sound rule is deliberately over-applied, with the
  aggressiveness as a tuned member.
- **`SmartPruningMinimumBatches`** forbids the rule from firing before `k` batches
  of work, added to prevent **"instamoves on slow backends"** — the sufficiency
  test is trivially satisfiable before any real information exists, and then it
  fires immediately and plays garbage.

---

## 37.3 Mapping onto our joints

### C66. C8's second factor is four counters we do not keep, and none of them costs anything

The hypothesis market and the reaction table have no computable score, and domain
34 supplied its *form* (an index) while leaving `P(refinement flips better())`
open. Stockfish estimates that probability from four quantities that are byproducts
of work already done:

  - **iterations since the incumbent last changed** (`rootDepth − lastBestMoveDepth`);
  - **how many times it changed this iteration** (`bestMoveChanges`);
  - **the trend of the incumbent's value**, against both the previous *turn*'s
    score and its own value four iterations back;
  - **the share of work spent under the incumbent** (`effort / nodes`).

  **We record none of them.** Our search knows its incumbent — the greedy
  incumbent is the interruptibility witness (C6) — but nothing counts how long it
  has held, how often it flipped, whether its value is falling, or how
  concentrated the spend on it is. Each is one integer in the search loop.

  **This is a bigger finding than an instrumentation note, for two reasons.**
  First, it is the *only* estimator of C8's factor that works before the bounds
  bank is complete: it needs no intervals, no model, no CPP. Second, three of the
  four are exactly the quantities the **CPP's second axis** wants — domain 16's
  C48 asked for "the margin at the deciding rung" as the discriminator between
  *search exhausted* and *evaluator too coarse*, and incumbent stability across
  rungs is that discriminator's cheapest form: **a search that has stopped
  changing its mind is exhausted; one that keeps flipping at the same score is
  coarse.**

### C67. A soft target and a hard ceiling, with a ratio of 3–7× — not one allowance

Our economy has an allowance and a deadline. Stockfish has **two** numbers with a
large gap and an adjustment that ranges freely between them: `optimumTime` is what
it *plans* to spend, `maximumTime` is what it *may* spend, and `maxScale` is
between 3.14 and 6.87. `fallingEval` alone spans 3×.

  The design point is not "have a cap" — it is that **the planned spend and the
  permitted spend are different numbers, and the gap is large.** A design in which
  the allowance *is* the ceiling cannot spend three times the plan on the turn that
  deserves it, and a design in which the ceiling *is* the plan overspends on every
  quiet turn. Our tranche ladder currently reads as the first.

  Note also what sets the gap: it is **not** a confidence interval or a risk
  budget, it is a tuned function of `ply` and of remaining clock. The permission to
  overspend is a property of the *game state*, not of the current search's
  uncertainty.

### C68. A performance profile denominated in milliseconds is not portable, and the field ships the fix

The TIME lens's v0 CPPs are keyed on wall-clock (`snake6 saturates at 500 ms`).
**That number is a property of the machine.** Recompiled, re-hosted, or run under
a different load, the same profile describes a different search — and every
conclusion of the form "saturates at X ms" becomes unfalsifiable across hardware,
which is exactly the property a profile must not have if it is going to price
tranches.

  Stockfish's answer is `nodestime`: denominate the budget in a **deterministic
  work unit** and calibrate to the clock separately. The consequences transfer
  directly:
  - the CPP becomes reproducible, so it can be **versioned and diffed** — which
    the lens already wants, having keyed it on `evalVersion` (M48);
  - a *regression* in the profile becomes attributable to the search rather than
    to the host;
  - and the calibration constant (work units per millisecond) becomes one
    measured, machine-local number instead of being smeared through every entry.

  The warning ships with it and should too: the assumed rate must be set **well
  below** real throughput, or the deadline is missed.

### C69. Stockfish's tuned constants are NOT knobs, and that is a deliberate boundary

Fifteen fitted constants appear in the two files above — `0.0029869`, `3.22713`,
`0.46866`, `0.19404`, `6.873`, `12.352`, `0.8097`, `2.229`, `1.077`, `0.639`,
`1.712`, `75800`, `104510`, `0.3272`, `0.4141` — and **not one is a user option**.
The options are `Ponder`, `Move Overhead`, `nodestime`, `Threads`, `Hash`: the
*structural* choices, plus the ones only the deployment knows.

  This is a shipped answer to a boundary question the composition lens is
  actively drawing. The knob bag's implicit rule is *a number that someone might
  want to change is config*. The engine's rule is sharper and better:

  > **A fitted constant is not a knob. Its value is a claim that won a test; a
  > knob is a claim nobody has made.**

  Exposing a tuned constant invites a setting that never passed the test that
  justified the number, and silently voids its provenance — which is ruling 49's
  concern stated as an access-control decision rather than a documentation one.
  The corollary is the useful half: **`keepQuiet: 2` and the four caps are either
  fitted (and belong in source with their provenance) or unfitted (and are
  admitting that nobody has tested them).** There is no third category, and the
  knob bag currently pretends there is.

### M92. Pondering is funded by raising the CURRENT move's budget, and a stop while pondering is not a stop

Two lines, both economically precise:

  - `optimumTime += optimumTime / 4` when Ponder is on. The engine does not reserve
    time for pondering; it **spends 25% more now** because the ponder will refund
    it. That is the correct direction and it is the opposite of how "fund ponder"
    is naturally read.
  - When the stop condition fires while pondering, the engine sets
    `stopOnPonderhit` instead of stopping. **Free compute is spent to exhaustion**,
    because it costs nothing and might hit.

  The TIME lens's v0 CPP conclusion was "fund ponder" read off a saturating
  profile. This is the shipped mechanism, and it says the funding is a multiplier
  on the *pre-ponder* budget, tuned at 1.25.

### M93. "Don't start an iteration you cannot finish" — the 50% rule

`increaseDepth = ponder || elapsed <= totalTime * 0.50`. Past half the adjusted
budget, no new iteration is begun.

  This is the **contract/interruptible distinction (C6) applied at the granularity
  of one rung**, and it is the piece our tranche design lacks. A rung that is
  abandoned mid-way returns nothing extra; the incumbent is whatever the previous
  rung produced. So the marginal value of *starting* a rung is not the rung's value
  — it is the rung's value times the probability of finishing it, and Stockfish
  approximates that with a hard 50% threshold. Note the exception: **while
  pondering, the rule is suspended**, because an unfinished ponder rung costs
  nothing.

### M94. Bad news is worth more computation than good news, at a measured 3×

`fallingEval` is not a symmetric measure of uncertainty; both its terms grow as
the position *worsens*. The design intent is explicit in the name.

  This has a clean reading in our vocabulary and it is one the design does not
  currently make: **the value of computation is asymmetric about the incumbent.**
  Refinement that might reveal a *loss* is worth more than refinement that might
  reveal a *gain*, because the downside is what you can still avoid. That is the
  same asymmetry the sound floor encodes at the *value* layer, appearing at the
  *allocation* layer — and the two should agree. If the floor is asymmetric and the
  spend rule is symmetric, the economy is systematically under-funding the
  positions the evaluator is most worried about.

### M95. Lc0's two guards are exactly what our bounds bank's version would need

The bounds bank already computes Lc0's condition: `backupMax`/`backupMin` maintain
per-option intervals, so *"can the remaining refinement flip `better()`?"* is an
overlap query — C8's factor exactly, not estimated. What Lc0 adds is the two
guards that make the sound rule usable, and both would be needed here:

  - **a deliberate over-prune factor** (default **1.33**, i.e. stop *before* the
    provable condition). The sound condition is too conservative to fire often
    enough to save time; the tuned factor is a member, in ruling 49's sense, with
    the failure direction stated (it can stop on a move it should not have).
  - **a minimum-work floor.** Before enough work exists, the intervals are wide and
    the condition is trivially satisfiable in the wrong direction — the analogue of
    Lc0's "instamove on a slow backend" is our bounds being `[−∞, +∞]` at tranche
    zero and the overlap test being vacuous. **Never let a sufficiency rule fire
    before a floor of work**, and that floor is a member too.

  The composition of the two answers is the recommendation: **use the exact rule
  where the bounds exist, and the four free counters everywhere else** — including
  before the bounds bank is complete, which is now.

---

## 37.4 The counter-argument

Stockfish's numbers are tuned for **sequential, perfect-information, one-move-per-
turn chess with a game clock**, and three of those differ for us. In particular:

- **The clock model is different.** Stockfish's `optScale` is a function of
  remaining clock and `ply` because it is dividing a *game budget* across an
  unknown number of remaining moves. If our allowance is per-turn and does not
  carry, the entire `timeLeft`/`mtg` apparatus is irrelevant and only the
  in-search multipliers transfer.
- **Simultaneity breaks "the best move has been stable".** In a simultaneous-move
  game the incumbent's stability is confounded with the enemy hypothesis it is
  conditioned on: a plan can be stable because the search is confident, or because
  the hypothesis has not been revised. **So `bestMoveChanges` must be counted per
  hypothesis, not globally**, or it will read as stable exactly when the market has
  stopped funding revision — which is the failure mode it is supposed to detect.
- **Our incumbent is a joint over units**, so "the best move changed" is not
  binary. The natural generalisation is the *fraction of units whose component of
  the incumbent changed*, which is strictly more informative and costs the same.

None of these weakens C66, C68 or C69, which are about what we record, in what
unit, and where it lives. They do mean the four multipliers must be **re-fitted,
not copied** — which is the right relationship to a member anyway.

---

## 37.5 Verdicts

- **TIME (C66, and this is the cheapest open item in the survey):** C8's second
  factor has two shipped implementations and we keep none of their inputs. Four
  integers in the search loop — **iterations since the incumbent changed**, **times
  it changed this iteration**, **the incumbent's value trend over a short ring
  buffer**, and **the share of work spent under the incumbent** — give
  `P(refinement flips the choice)` with no model, no intervals and no CPP. Three of
  the four are also the discriminator C48 asked for: *a search that has stopped
  changing its mind is exhausted; one that keeps flipping at the same score is
  coarse.* Count them per **hypothesis**, not globally, or simultaneity confounds
  the signal.
- **TIME (C67):** carry a **soft target and a hard ceiling with a large gap** —
  Stockfish's ratio runs 3.14× to 6.87×, and the eval-trend factor alone spans 3×.
  An allowance that is also the ceiling cannot spend three times the plan on the
  turn that deserves it. And the gap is set by *game state* (ply, remaining clock),
  not by the current search's uncertainty.
- **TIME / MEASUREMENT (C68):** **a CPP keyed on milliseconds is a property of the
  machine.** "Saturates at 500 ms" is unfalsifiable across hardware, which is fatal
  for a number that prices tranches. Ship `nodestime`'s idea: denominate the budget
  in a **deterministic work unit**, calibrate to the clock as one measured
  machine-local constant, and the profile becomes versionable, diffable and
  attributable — which is what keying it on `evalVersion` was already reaching for.
- **COMPOSITION (C69):** fifteen tuned constants live in Stockfish's *source*; the
  user options are the structural choices only. **A fitted constant is not a knob —
  its value is a claim that won a test, and a knob is a claim nobody has made.**
  Exposing one invites a setting that never passed the test that justified the
  number. Corollary for the knob bag: each of `keepQuiet: 2` and the four caps is
  either fitted (belongs in source with its provenance) or unfitted (which is an
  admission, not a configuration). There is no third category.
- **TIME (M92, M93, M94):** pondering is funded by making the **current** move 25%
  more expensive, not by reserving; a stop while pondering is not a stop
  (`stopOnPonderhit`) because free compute is spent to exhaustion; **no new rung is
  begun past 50% of the budget** (a rung is a contract algorithm — its marginal
  value is its value times `P(finish)`), with the rule suspended while pondering;
  and **bad news is worth more computation than good news at a measured 3×** — an
  asymmetry the sound floor already encodes at the value layer and the allocation
  layer does not, which means the economy is under-funding exactly the positions
  the evaluator is most worried about.
- **SEARCH (M95):** the bounds bank already computes Lc0's exact rule — *can the
  remaining refinement flip `better()`?* is an interval-overlap query. Copy its two
  guards, because both are what make a sound rule usable: a **deliberate
  over-prune factor** (Lc0's default is **1.33**, i.e. stop *before* the provable
  condition, as a member with its failure direction stated) and a **minimum-work
  floor**, because at tranche zero the bounds are vacuous and the sufficiency test
  fires in the wrong direction. Use the exact rule where bounds exist and the four
  free counters everywhere else — including now, before the bank is complete.
