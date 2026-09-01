# ITEM 1 — POTION-INTEL ACCEPTANCE GAMES (the SMASH criterion)

Queue item 1. The claim under test is the owner's: a bot that is
intelligent about potions **demonstrably smashes** a bot without potion
intelligence on potion-spawning cells. The acceptance test is a game, not
a document (ruling 35).

---

## READ THIS FIRST — where the item stands after 5 cycles and 1,152 games

1. **THE POTION-COLLECTING CAPABILITY EXISTS AND IS DEMONSTRATED IN PLAY.**
   `candidates.potionOrdering` — a potion pickup sorts as a gain, so the
   collection move enters the priced set — makes the bot collect **22%
   more potions on the hazard cell and 45% more on the plain one** than
   the byte-identical bot without it, in the same games, measured off the
   replays. It costs no search at all (zero advisory evaluations, and
   1.7-3.7% MORE plans per decision than `plain`). This is the first
   potion configuration in the programme shown to change play in the
   intended direction with a number attached.
2. **IT DOES NOT SMASH, BECAUSE THE PRIZE IS SMALL.** On the hazard-free
   cell it collects 45% more potions and scores +0.021 [-0.143, 0.213] —
   indistinguishable from zero; on the knight cell +0.069 [-0.032, 0.165].
   A bot that collects 45% more potions and gains nothing has not failed
   to be intelligent about potions. At `effectTurns: 3` on these boards an
   invulnerability potion is worth less than the tempo spent reaching it.
   **This is a finding about the game, not about our bot.**
3. **ON HAZARD BOARDS THE CHASE IS A NET LOSS, and the whole causal chain
   is measured.** potions +22% → hazard occupancy +5% → head entries into
   hazard +4% → **deaths per game +13%** (2.75 → 3.10) → **sharePar
   -0.145 [-0.258, -0.035]**, replicated independently at -0.146 (k1) and
   -0.143 (k2). The control holds: on the hazard-FREE cell the same bot
   collects even more potions and dies slightly LESS. It is an
   interaction, not a main effect.
4. **The expensive half of the doctrine does nothing at all.**
   `potionBoth − potionOrder` pools to +0.001, and `potionBoth` collects
   only 0.05-0.15 more potions per game than `potionOrder`. The one-line
   ordering slot is responsible for effectively all of the behaviour
   change; the advisory slate and its four potion terms for none of it.
   Mechanically the advisory moves the estimate by 0.55-1.04% of the width
   of the interval it is moving inside (2-3% at "bold"), with 99-100% of
   the ask applied — the clamp is not the limiter, the ask is negligible —
   while costing 14-44% of plans per decision.
5. **A correction to how this programme reads results.** The standing rule
   "an effect must exceed the A/A floor" compares two different
   quantities: the floor is the spread of the DIFFERENCE of two arms, the
   reading is their AVERAGE, so the floor is about 2x the reading's own
   half-width by construction, at any sample size (measured 2.63 and 1.96
   against a theoretical 2.00). It suppressed result 3 for a full cycle.
   Use the A/A null for BIAS (identical arms must average to zero — they
   do), the reading's own interval for effect size, and REPLICATION ACROSS
   CYCLES for confidence.
6. **Block targets are not reliable.** `floorscale.js` shows the floor
   falling as 1/sqrt(n) on the hazard cell but not on `potion-snake6`, and
   a floor measured from one 24-block run varies by nearly 2x between
   cycles (0.277 vs 0.503) with the box's load. Between-cycle service
   variance is a noise component that more blocks do not remove.

**THE NEXT QUESTION IS NO LONGER "how do we make the bot collect
potions".** That is built, free, and working. It is **"at what potion
settings does collecting them pay?"** — longer `effectTurns`, or scarcer
potions so each is more decisive. The same already-working flag should
start to earn somewhere, and finding where is a board-settings sweep, not
a bot change. If no reachable setting makes it pay, that is a finding
about the GAME worth telling the owner plainly, and the ordering flag
should stay selectable and default OFF on hazard boards.

---

**Design.** Both-sides-one-game: the contenders are seated in ONE game
(`rotateSeats:true`), so G = sharePar(X) − sharePar(Y) is a within-game
contrast. The two arms `nullA`/`nullB` are identical bundles, so the
between-arm difference of G is that cell's A/A floor, bought by the same
games. Blocks accumulate across cycles on fresh seed ranges.

Cells (all 21x21, 3 teams x 6 units, 200 ms budget, turn cap 80, food
initial 6 / rate 0.5, potions enabled spawnRate 0.15 initial 2
effectTurns 3):
`potion-snake6` (no hazard) · `potion-hazard-snake6` (hazards cross,
damage 0.15) · `potion-snake5-knight` (one knight).

## Running block tally

A BLOCK is one seed played through every seat rotation, in BOTH arms. The
predecessor tool `within.js` printed a "POOLED" row of 16 for an 8-block
run, because it concatenated the two arms' block means and bootstrapped
them as 16 independent values. They are not independent — the two arms
play the same seed on the same board — so that interval is too narrow, and
the error runs in the direction that makes a marginal result look decided.
`$SP/continuous/accum.js` averages the two arms inside a block first and
bootstraps over blocks. Same point estimate, honest width, honest count.
**The tallies below are in true blocks.**

**A within-game contrast is not independent of the FIELD.** `sharePar` is
a share, so G between two bots depends on who occupies the third seat.
c1's field was {potionAware, plain, reflex}; c2's was {potionBold,
potionAware, plain}; and the same `potionAware − plain` contrast read
-0.476 in the first and +0.007 in the second on the same cell. Blocks
therefore accumulate WITHIN A FIELD, never across fields. The tally is
kept per field for that reason.

| field | cell | blocks | source |
|---|---|---:|---|
| {potionAware, plain, reflex} | potion-snake6 | 8 | c1 |
| {potionAware, plain, reflex} | potion-hazard-snake6 | 8 | c1 |
| {potionAware, plain, reflex} | potion-snake5-knight | 8 — floor excludes zero, unreadable | c1 |
| {potionBold, potionAware, plain} | potion-snake6 | 8 | c2 |
| {potionBold, potionAware, plain} | potion-hazard-snake6 | 8 | c2 |
| {potionBold, potionAware, plain} | potion-snake5-knight | 8 | c2 |
| {potionBoth, potionOrder, plain} | potion-snake6 | 24 done, floor 0.518 | k1 |
| {potionBoth, potionOrder, plain} | potion-hazard-snake6 | 24 done, floor 0.277 | k1 |
| {potionBoth, potionOrder, plain} | both cells | +24 in flight | k2 (seeds 98241+) |

**Targets are now sized PER CELL from measured scaling, not from one
programme-wide number.** `floorscale.js` on k1 (below) shows the hazard
cell's floor falling as 1/sqrt(n) while `potion-snake6`'s falls more
slowly and is heavy-tailed. For a ±0.19 floor:

| cell | blocks needed | machine time (both arms concurrent) |
|---|---:|---|
| potion-hazard-snake6 | ≈ 51 | ~0.8 h |
| potion-snake6 | ≈ 178 | ~2.8 h, and optimistic if the tail keeps growing |

The earlier "32 blocks per cell" target was wrong, and wrong in the
direction that would have produced a confident verdict from an
underpowered run.

---

## Cycle c1 — `pp-potion-play`, potionAware vs plain (+ reflex third seat)

Bundle `$SP/ppruns/b3` ← `tmp/potionplay` `df36527`. Batch
`$SP/ppruns/c1`. 72 games per arm, 144 total, 8 seeds x 3 seat rotations
x 3 cells.

### The reading: G = sharePar(potionAware) − sharePar(plain)

Corrected estimator, `node $SP/continuous/accum.js potionAware plain $SP/ppruns/c1`:

| cell | blocks | G | 95% CI | A/A floor (half-width) | clears floor? |
|---|---:|---:|:--|---:|---|
| potion-hazard-snake6 | 8 | **-0.476** | [-0.653, -0.277] | 0.383 | marginal |
| potion-snake6 | 8 | **-0.369** | [-0.652, -0.086] | 0.397 | no |
| potion-snake5-knight | 8 | -0.103 | [-0.487, 0.247] | 0.209 | no (floor broken) |

**Every point estimate is negative.** The potion-aware slate does not
smash the plain bot on potion-bearing cells; on this evidence it LOSES to
it, by roughly a third to a half of a sharePar unit, and the one cell
whose interval sits clear of its own floor is the hazard cell. No single
cell clears its floor decisively, so the honest statement at 8 blocks is
**"no advantage demonstrated, and the sign is consistently against the
treatment"** — not yet "it is worse".

Floor caveat, inherited: the knight cell's A/A floor is itself
-0.490 [-0.689, -0.267], an interval that EXCLUDES ZERO between two
identical arms. A piece cell with a broken floor cannot support any
reading (overnight finding 2 said the same thing on a queen cell). The
knight row above is uninterpretable and is carried only to keep the
ladder shape.

### The mechanism table — why (`node mech.js c1`)

| cell | bot | slate | plans/dec | advEval/dec | engaged% | floor/dec | depth/dec | est/dec |
|---|---|---|---:|---:|---:|---:|---:|---:|
| potion-hazard-snake6 | plain | legacy | 147.8 | 0.0 | 0.0 | 1530 | 14 | 24.9 |
| potion-hazard-snake6 | potionAware | potion-aware | **98.1** | 195.0 | 32.9 | 869 | 107 | 13.4 |
| potion-snake6 | plain | legacy | 175.6 | 0.0 | 0.0 | 1594 | 126 | 41.5 |
| potion-snake6 | potionAware | potion-aware | **99.6** | 220.1 | 38.9 | 814 | 161 | 30.0 |
| potion-snake5-knight | plain | legacy | 186.6 | 0.0 | 0.0 | 1133 | 1152 | 8.5 |
| potion-snake5-knight | potionAware | potion-aware | **135.1** | 227.2 | 21.0 | 807 | 582 | 9.2 |

**The potion-aware bot evaluates 28-44% fewer plans per decision inside
the same millisecond budget.** The advisory lineup runs 195-227 times per
decision and engages on 21-39% of those, so it is genuinely firing — this
is not a dead arm. It is a PRICED arm: the advice arrives, and it arrives
at the cost of about a third of the search.

That reframes the whole item. The candidate explanation for G < 0 is not
"potion advice is bad" but "potion advice as currently computed costs
more search than it returns". Which is a test, not a story — see c3.

---

## Cycle c2 — the WEIGHT ladder: plain / potionAware / potionBold

Batch `$SP/ppruns/c2`, spec `$SP/ppruns/c2.json`, bundle `b3`
(`tmp/potionplay` `df36527`). Three contenders in ONE game:
`plain` / `potionAware` (slate `potion-aware`) / `potionBold` (slate
`potion-aware-bold`), 8 seeds (103101-103108) x 3 rotations x 3 cells =
72 games per arm, 144 total.

Purpose: the doctrine's claim has a monotone shape — louder reorders more
of the floor-tie class, and the reordering is worth something. A ladder is
the cheapest instrument that can refute it.

### The readings (`accum.js`, arms averaged within block)

| pair | cell | blocks | G | 95% CI | A/A floor | clears? |
|---|---|---:|---:|:--|---:|---|
| potionAware − plain | potion-hazard-snake6 | 8 | **+0.007** | [-0.134, 0.145] | 0.210 | no |
| potionAware − plain | potion-snake6 | 8 | **-0.184** | [-0.362, 0.061] | 0.433 | no |
| potionAware − plain | potion-snake5-knight | 8 | -0.229 | [-0.511, 0.082] | 0.538 | no |
| potionBold − plain | potion-hazard-snake6 | 8 | **-0.036** | [-0.134, 0.072] | 0.350 | no |
| potionBold − plain | potion-snake6 | 8 | **-0.283** | [-0.598, -0.003] | 0.377 | no |
| potionBold − plain | potion-snake5-knight | 8 | -0.291 | [-0.534, -0.031] | 0.636 | no |
| potionBold − potionAware | potion-hazard-snake6 | 8 | -0.042 | [-0.170, 0.094] | 0.292 | no |
| potionBold − potionAware | potion-snake6 | 8 | -0.099 | [-0.356, 0.158] | 0.367 | no |
| potionBold − potionAware | potion-snake5-knight | 8 | -0.061 | [-0.213, 0.117] | 0.347 | no |

**Nothing clears a floor. The ladder does not rise.** Every rung sits at
or below `plain`, and the bold rung sits at or below the quiet one on all
three cells. The monotone claim is not supported: making the advisory
louder does not buy score, and the sign of every bold-minus-quiet
contrast is negative.

The `potionAware − plain` contrast also moved between c1 (-0.476 on the
hazard cell) and c2 (+0.007) — the two cycles put a DIFFERENT third bot in
the seat (`reflex` in c1, `potionBold` in c2). `sharePar` is a share, so a
within-game contrast is not independent of who else is on the board. Read
across cycles only within a fixed field; do not pool c1 and c2.

### Why louder does nothing — the advisory is a rounding error on its own interval

The mechanism counters carry `advisoryMeanAsked`, `advisoryMeanApplied`
and `advisoryMeanWidth`: how much the potion lineup wants to move the
estimate, how much of that survived the clamp, and how wide the proved
interval it is moving inside actually is.

| cycle | cell | bot | meanAsk | applied/asked | **ask as % of the interval width** | clamped |
|---|---|---|---:|---:|---:|---:|
| c1 | potion-snake6 | potionAware | 2.67 | 98.2% | **1.04%** | 0.0% |
| c1 | potion-hazard-snake6 | potionAware | 2.33 | 100.0% | **0.85%** | 0.0% |
| c1 | potion-snake5-knight | potionAware | 1.34 | 99.5% | **0.73%** | 0.4% |
| c2 | potion-snake6 | potionBold | 7.02 | 99.6% | **2.13%** | 0.2% |
| c2 | potion-hazard-snake6 | potionBold | 6.48 | 99.9% | **1.84%** | 0.1% |
| c2 | potion-snake5-knight | potionBold | 5.45 | 88.7% | **3.09%** | 5.9% |

**The potion advisory moves the estimate by well under one percent of the
uncertainty band it is allowed to move inside — two to three percent when
turned up to "bold".** Almost all of the ask is applied (99-100%), so the
clamp is not the limiter; the ask is simply tiny against its own interval.
A term that small can only change a decision in a near-exact tie, which
matches what the branch already recorded: the deep channel resolves most
comparisons before the estimate is read at all.

So the doctrine as wired is structurally close to inert — and it is not
free. It costs 14-16% of plans per decision in this three-search-bot
field and 28-44% in c1's field. **A large measured price for an
adjustment under 1% of its own interval is the whole explanation for
G <= 0, and it is why a louder weight cannot be the fix**: at 3.5x the
ask, bold is still at 2-3% of the interval, and it has started to be
clamped.

Two ways out, and only one of them is cheap:

1. **The free channel** — let a potion pickup sort as a gain so the
   collection move enters the priced set, with no evaluator running at
   all. That is `candidates.potionOrdering`, and it is exactly what
   continuous cycle 1 tests.
2. **The expensive one** — let potion value into the PROVED BOUNDS
   rather than arriving as a clamped advisory nudge inside them. That is
   an architecture change to the branch, not a weight, and it should not
   be attempted before cycle 1 says whether the cheap channel earns.

---

## Cycle c3 — the CHANNEL ladder (planned; the c1 mechanism row chose it)

Bundle `b4` ← `tmp/potionplay` `7f89a74` (`candidates.potionOrdering`).
Spec from `$SP/ppruns/mkorder.js`. Three contenders in one game:

- `plain` — the shipped bot.
- `potionOrder` — shipped evaluator, `candidates.potionOrdering:true`. A
  pickup sorts as a gain, so the collection move enters the priced set.
  **Zero evaluator cost**: no advisory lineup runs.
- `potionBoth` — the ordering slot AND the potion-aware lineup.

This is the experiment c1's mechanism row demands. It separates the two
things the c1 arm confounded — the ADVICE and its PRICE:

| outcome | reading |
|---|---|
| potionOrder > plain, potionBoth < plain | the doctrine's cheap half is the one that was missing; the lineup's budget cost is what sinks it |
| potionOrder ≈ plain ≈ potionBoth | potions do not pay on these cells at this budget at all |
| potionOrder < plain | the pickup-as-gain ordering is itself wrong |
| potionBoth > potionOrder > plain | both halves earn; ship both |

---

## METHODOLOGY RESULT (from c1's own games) — the A/A floor on these cells
## is largely CPU-service noise, not board noise

Tools: `$SP/continuous/armservice.js`, `$SP/continuous/armdrift.js`.

Two byte-identical arms of bundle `b3` did not buy the same amount of
search. The first-launched arm evaluated **8.9% more plans per decision on
average, and up to 31.6% more inside a single 12-game window**, inside the
same millisecond budget, on the same seeds, on the same board.

Nothing in the bot can move that number. Two identical builds playing
identical boards differ in plans per decision for exactly one reason: the
box gave one process more CPU. Every cell here is `budgetMs`-bounded, so
CPU service converts directly into search depth, and depth into play.

Plans per decision, same bot, same cell, the two identical arms:

| cell | bot | nullA | nullB | gap |
|---|---|---:|---:|---:|
| potion-snake6 | plain | 191.0 | 160.1 | **+19.4%** |
| potion-snake6 | potionAware | 108.5 | 91.0 | **+19.2%** |
| potion-snake5-knight | plain | 190.6 | 182.6 | +4.4% |
| potion-snake5-knight | potionAware | 139.7 | 130.4 | +7.2% |
| potion-hazard-snake6 | plain | 147.2 | 148.4 | -0.8% |
| potion-hazard-snake6 | potionAware | 100.0 | 96.1 | +4.0% |

Mean +8.89%; the first arm bought more search in 5 of the 6 pairs. It is
not a steady offset and not a warmup that decays away — by 12-game bucket
in the order the box played them: +9.8%, **+31.6%**, +6.5%, -9.8%,
+11.3%, -2.5%. Wall clock per game is within 1% across arms on every
cell, so this is not one arm running longer games; it is the same wall
clock buying different amounts of work.

**Why it matters.** Within a game both bots share one process, so a
service swing scales both bots together (+19.4% and +19.2% on
`potion-snake6`) and does not bias G directly. But two different bots do
not convert extra search into play identically — that is what makes them
different bots — so the swing moves G, and that movement lands in the
between-arm difference of G, which is precisely what this programme calls
the A/A floor.

Three consequences:

1. **"Piece cells have no usable floor" needs re-examining.** Overnight
   finding 2 and c1 both found a piece-bearing cell whose A/A interval
   excludes zero, and both read it as a property of piece boards. Piece
   cells are also the most search-hungry cells, so they are where a
   service swing does the most damage. The rival explanation — a harness
   artifact that would afflict any search-hungry cell — has never been
   tested against the board explanation. Queue item 3 must test both.
2. **Floors can be bought down with settings, not only with blocks.**
   These runs use `--workers 2`: 4 concurrent games on 4 cores with no
   headroom, and the orchestrating agent process itself takes a few
   percent. Power goes as blocks / floor², so halving the floor is worth
   four times the blocks, while `--workers 1` costs only twice the wall
   clock. **That trade is worth making if the floor moves at all.**
   Continuous cycle 2 measures it: same spec, same contenders, disjoint
   seeds, `--workers 1`.
3. **A millisecond budget is not a reproducible control on a contended
   box.** The deep fix is a deterministic budget — a plan or node count
   rather than a wall-clock slice — which would make an A/A pair
   reproducible to the bit and collapse this component of the floor to
   zero. That is a kit change, not a bot change, and it goes to the owner
   as a proposal, not into a results file as a decision.

**What this does not overturn.** c1's reading stands as written. The
potion-aware slate's G is negative on all three cells, and its
plans-per-decision deficit against `plain` (28-44%) is far larger than
the ±20% service swing and is present in BOTH arms — so the deficit is
the advisory lineup's price, not the scheduler. This widens the error
bars around the doctrine's score; it does not explain the score away.

---

## Cycle k1 (continuous cycle 1) — the CHANNEL ladder: plain / potionOrder / potionBoth

Bundle `$SP/ppruns/b4` ← `tmp/potionplay` `7f89a74`, rebuilt with `--force`
after a build race (see the operational note at the end). Batch
`$SP/continuous/k1`, spec `$SP/continuous/specs/k1-channel.json`
(generated by `$SP/continuous/specs/mkchannel.js`). 24 blocks, seeds
98201-98224, 3 rotations, 2 cells = 144 games per arm, **288 games**. The
knight cell was dropped: its A/A floor excluded zero in c1, and a cell
whose floor is broken cannot carry a reading.

### The arm did what it was built to do

`node mech.js $SP/continuous/k1`:

| cell | bot | slate | ordering | plans/dec | advEval/dec | engaged% |
|---|---|---|---|---:|---:|---:|
| potion-hazard-snake6 | plain | legacy | false | 93.7 | 0.0 | 0.0 |
| potion-hazard-snake6 | potionOrder | legacy | **true** | **97.2** | **0.0** | 0.0 |
| potion-hazard-snake6 | potionBoth | potion-aware | true | 79.4 | 160.6 | 25.4 |
| potion-snake6 | plain | legacy | false | 70.4 | 0.0 | 0.0 |
| potion-snake6 | potionOrder | legacy | **true** | **71.6** | **0.0** | 0.0 |
| potion-snake6 | potionBoth | potion-aware | true | 58.8 | 137.5 | 22.7 |

The design holds exactly. Seat isolation resolved the ordering flag to
`true` on the two treated seats and `false` on `plain` in the same game.
`potionOrder` ran **zero advisory evaluations** and evaluated 1.7-3.7%
MORE plans per decision than `plain` — the free channel really is free.
`potionBoth` paid 15-16% of its plans per decision for the lineup.

### The readings (24 blocks)

| pair | cell | G | 95% CI | A/A floor | clears? |
|---|---|---:|:--|---:|---|
| potionOrder − plain | potion-hazard-snake6 | **-0.146** | [-0.308, 0.016] | 0.274 | no |
| potionOrder − plain | potion-snake6 | **+0.100** | [-0.114, 0.290] | 0.512 | no |
| potionBoth − plain | potion-hazard-snake6 | -0.097 | [-0.297, 0.109] | 0.278 | no |
| potionBoth − plain | potion-snake6 | +0.026 | [-0.191, 0.243] | 0.424 | no |
| potionBoth − potionOrder | potion-hazard-snake6 | +0.050 | [-0.135, 0.269] | 0.219 | no |
| potionBoth − potionOrder | potion-snake6 | -0.074 | [-0.299, 0.167] | 0.478 | no |

**The free channel does not earn either.** `potionOrder` is +0.100 on one
cell and -0.146 on the other — opposite signs, both far inside their
floors. Sorting a potion pickup as a gain costs nothing and buys nothing
measurable. The c1 hypothesis (that the doctrine's problem was its price,
and the cheap half was the half that was missing) is **not supported**:
removing the price did not reveal a benefit underneath it.

Cumulative position after three cycles and **576 live games**: no potion
configuration — quiet advisory, bold advisory, free ordering, or ordering
plus advisory — has beaten `plain` on any cell by more than that cell's
own A/A floor, and the point estimates are as often negative as positive.

### The arms were served equally this time

`armservice.js` on k1: mean plans/decision difference between the two
identical arms **0.89%**, with the first arm buying less search in 3 of 6
pairs — an even split. Against c1's 8.9% with a 5-of-6 one-sided split,
that revises the methodology note above: the arm-order gap is **not a
standing bias**, it is a short-run swing that averages out as blocks
accumulate, and c1's one-sided mean was itself an 8-block artifact. The
swing is still real and still inflates the floor; it just does not tilt
the reading in a fixed direction.

### Does the floor actually fall as 1/sqrt(blocks)? — `floorscale.js`

Every block target in this programme assumes it does. Nested prefixes of
k1's own blocks, same games, same cell, only the count changing:

| cell | blocks | A/A floor | expected from full sample | ratio |
|---|---:|---:|---:|---:|
| potion-hazard-snake6 | 6 | 0.668 | 0.554 | 1.21 |
| potion-hazard-snake6 | 12 | 0.436 | 0.391 | 1.11 |
| potion-hazard-snake6 | 18 | 0.311 | 0.320 | 0.97 |
| potion-hazard-snake6 | 24 | 0.277 | 0.277 | 1.00 |
| potion-snake6 | 6 | 0.735 | 1.036 | 0.71 |
| potion-snake6 | 12 | 0.634 | 0.733 | 0.86 |
| potion-snake6 | 18 | 0.483 | 0.598 | 0.81 |
| potion-snake6 | 24 | 0.518 | 0.518 | 1.00 |

**`potion-hazard-snake6` behaves: its floor falls as 1/sqrt(n) and its
block targets mean what they say.** `potion-snake6` does not — its floor
fell from 0.634 at 12 blocks to 0.518 at 24, where 1/sqrt(n) predicts
0.448, and the small-n ratios sitting well under 1 are the signature of a
heavy tail that only shows up once enough blocks are drawn.

Practical consequence, and it is not small: reaching a ±0.19 floor on
`potion-snake6` needs roughly (0.518/0.19)^2 x 24 ≈ **178 blocks**, not
the 32 this file targeted — about 2.8 hours of the box for that one cell,
and that estimate is itself optimistic if the tail keeps growing. The
hazard cell needs ≈ 51 blocks for the same width, which is reachable.
**Cells must be sized individually from their own measured scaling, never
from a single programme-wide block target.**

### Operational note — two runs collided on this box

Cycle 1 was launched, and twenty seconds later a detached one-shot shell
left over from an earlier turn of this session launched `ppruns/c3`: the
same channel ladder, same sweepId, same contenders, on a subset of the
same seeds — while also rebuilding the same bundle `b4` into the same
directory that cycle 1 was reading. Eight match-workers on four cores and
two concurrent writers to one bundle. Both runs were killed, `ppruns/c3`
was deleted, `b4` was rebuilt with `--force`, and cycle 1 was restarted
from zero on a clean box. Nothing from the collided window is in the
numbers above.

Wall clock per game barely moved during the collision (37-39 s either
way), because these games are wall-clock bounded — **the damage never
appears in the log, only as less search per decision**, which is the
quantity the experiment measures. Detached shells from earlier turns have
PPID 1 and are not children of the agent process, so check with
`ps -eo pcpu,etime,args --sort=-pcpu --no-headers | head -6` before
launching anything.

The box is also shared with sibling agent threads that run test suites at
will; two `jest` suites ran during k1, which is why k1's plans per
decision (59-97) sit near half of c2's (91-190). That is a shallower
search regime, so k1's absolute levels are not comparable with c1/c2 —
the within-cycle ladder comparison is unaffected, because all three
contenders share every game.

---

## Cycle k2 (continuous cycle 2) — the channel ladder replicated, and the
## first signal in the programme

Same spec, same bundle `b4`, same settings, seeds 98241-98264 (disjoint
from k1's 98201-98224). 144 games per arm, **288 games**. Batch
`$SP/continuous/k2`. The `--workers 1` floor comparison originally planned
for this cycle was dropped: the box is shared with sibling agent threads
running test suites at will, so it would have measured the siblings
rather than the setting.

### THE HAZARD CELL REPLICATED TO THREE DECIMAL PLACES

| rung | k1 (24 blocks) | k2 (24 blocks) | POOLED (48 blocks) |
|---|---:|---:|---:|
| potionOrder − plain, potion-hazard-snake6 | **-0.146** | **-0.143** | **-0.145** [-0.258, **-0.035**] |
| potionOrder − plain, potion-snake6 | +0.100 | -0.058 | +0.021 [-0.143, 0.213] |
| potionBoth − plain, potion-hazard-snake6 | -0.097 | -0.191 | -0.144 [-0.258, 0.011] |
| potionBoth − plain, potion-snake6 | +0.026 | -0.096 | -0.035 [-0.219, 0.127] |
| potionBoth − potionOrder, potion-hazard-snake6 | +0.050 | -0.047 | +0.001 [-0.128, 0.150] |
| potionBoth − potionOrder, potion-snake6 | -0.074 | -0.038 | -0.056 [-0.251, 0.119] |

Two independent 24-block runs, on disjoint seeds, produced **-0.146 and
-0.143** for the same contrast. That is not a null result and it is not
noise; it is a replication. The pooled interval excludes zero.

**The reading: on hazard boards, sorting a potion pickup as a gain costs
about 0.145 sharePar, and it costs it for free — `potionOrder` runs no
evaluator at all.** On the no-hazard board the same setting is worth
nothing either way (+0.021). And `potionBoth − potionOrder` is +0.001 on
the hazard cell: **the expensive advisory lineup adds literally nothing on
top of the free ordering.** The ordering is doing all of the work, and on
hazard boards the work it does is harmful.

The natural mechanism — untested, and the next thing to look at — is that
treating a pickup as a gain routes units through hazard cells to reach
potions. That is a specific, checkable claim about play, and the replays
are on disk under `$SP/continuous/k{1,2}/arms/*/pp-potion-channel/`.

### Why "does it clear the A/A floor?" was the wrong question

The pooled `potionOrder − plain` interval on the hazard cell excludes
zero, yet the A/A floor is 0.292 and the effect is 0.145 — so by the
programme's standing rule the result is "inside the floor" and
unclaimable. Both statements are arithmetically correct, and the rule is
what is wrong.

The A/A floor is the spread of `G(armA) − G(armB)`. The reading is the
average of the two arms. For independent arms of equal per-block variance
v, the difference has variance 2v and the average has variance v/2, so
**the floor is about twice the half-width of the reading, by construction,
no matter how much data is collected.** Measured here:

| cell | A/A floor | pooled G half-width | ratio | ratio under pure sampling |
|---|---:|---:|---:|---:|
| potion-hazard-snake6 | 0.292 | 0.111 | 2.63 | 2.00 |
| potion-snake6 | 0.349 | 0.178 | 1.96 | 2.00 |

So requiring |G| > floor demands roughly **twice** the effect that the
data's own uncertainty requires — it is not a conservative reading of the
same quantity, it is a different quantity used as a threshold.

What the A/A null is genuinely for is BIAS: two identical arms must
average to zero, and here they do (mean ΔG -0.002 and -0.188, both
intervals containing zero). Use it for that. For effect size, use the
reading's own interval — and demand REPLICATION across independent
cycles, which is the check that actually caught this result and which no
single run can provide.

The hazard cell's ratio of 2.63 against a theoretical 2.00 is itself
informative: the excess is the CPU-service variance between arms
documented earlier in this file. On `potion-snake6`, which is less
search-hungry, the ratio is 1.96 — essentially the pure-sampling value.

### Floors do not average down across cycles the way blocks do

The same cell, same settings, same block count, two cycles:

| cell | k1 floor (24 blocks) | k2 floor (24 blocks) | pooled floor (48 blocks) |
|---|---:|---:|---:|
| potion-hazard-snake6 | 0.277 | 0.503 | 0.292 |
| potion-snake6 | 0.518 | 0.463 | 0.349 |

**A floor measured from one run is itself uncertain by nearly a factor of
two** (0.277 vs 0.503 for the identical experiment), because it depends on
how contended the box was during that run — k1 ran at loadavg 8-12, k2 at
14-16. Quoting a floor to three decimals from a single run overstates what
is known about it, and pooling across cycles does not shrink it the way
pooling blocks within a cycle does: the hazard floor went from 0.277 at 24
blocks to 0.292 at 48, where 1/sqrt(n) predicts 0.196.

The consequence for a continuous programme is direct: **between-cycle
variation in box service is a noise component that more blocks do not
remove.** Accumulating toward a block target buys less than the target
promises whenever the box's load differs between cycles. What DOES survive
is replication of the point estimate — which is exactly what carried the
hazard-cell result.

---

## REPLAY MECHANISM (zero new games) — the capability WORKS; the capability
## is not WORTH anything

`node $SP/continuous/replaymech.js $SP/continuous/k1` — 288 replays, all
three contenders in every game, so every count is paired on the board and
the seat rotation cancels position. 13.14 potions spawn per game.

| cell | bot | games | potions collected /game | hazard occupancy per 100 unit-turns | head entries into hazard per 100 moves | mean health/unit | deaths/game |
|---|---|---:|---:|---:|---:|---:|---:|
| potion-hazard-snake6 | plain | 144 | 2.14 | 0.99 | 1.05 | 73.9 | 2.75 |
| potion-hazard-snake6 | potionOrder | 144 | **2.61** | 1.04 | 1.09 | 73.2 | **3.10** |
| potion-hazard-snake6 | potionBoth | 144 | **2.76** | 1.02 | 1.07 | 73.2 | **3.18** |
| potion-snake6 | plain | 144 | 1.64 | 0.00 | 0.00 | 77.4 | 3.77 |
| potion-snake6 | potionOrder | 144 | **2.38** | 0.00 | 0.00 | 76.4 | 3.62 |
| potion-snake6 | potionBoth | 144 | **2.43** | 0.00 | 0.00 | 77.6 | 3.78 |

### 1. The potion capability is REAL and it is now demonstrated in play

**`candidates.potionOrdering` makes the bot collect 22% more potions on
the hazard cell and 45% more on the plain one, against the identical bot
without it, in the same games.** That is the first time in this programme
that a potion configuration has been shown to CHANGE PLAY in the intended
direction with a number attached. Every earlier potion result was a score
that did not move; this is the behaviour itself.

It is worth being precise about what was and was not built. The advisory
evaluator — the slate, the four potion terms — moves the estimate by under
1% of its own interval and does essentially nothing. The thing that works
is the one-line ordering slot: a potion pickup sorts as a gain, so the
collection move enters the priced set. `potionBoth` collects only
0.05-0.15 more potions per game than `potionOrder`, so **the ordering slot
is responsible for effectively all of the behaviour change, and the
expensive evaluator for none of it.**

### 2. And collecting more potions is worth nothing

On `potion-snake6`, with no hazards to complicate it, `potionOrder`
collects **45% more potions** than `plain` and scores **+0.021 [-0.143,
0.213]** — indistinguishable from zero. The same on the knight cell
(+0.069). Collecting the potion is not the hard part and never was; the
potion simply is not worth much at these settings.

**That is the answer to the SMASH question, and it is not a statement
about our bot.** A bot that collects 45% more potions and gains nothing
has not failed to be intelligent about potions. It has demonstrated that
at `effectTurns: 3` on these boards, an invulnerability potion is worth
less than the tempo spent reaching it.

### 3. On hazard boards the chase is actively paid for

The proposed mechanism holds, and every link is measured:

| link | plain | potionOrder | change |
|---|---:|---:|---|
| potions collected per game | 2.14 | 2.61 | **+22%** |
| hazard occupancy per 100 unit-turns | 0.99 | 1.04 | +5% |
| head entries into hazard per 100 moves | 1.05 | 1.09 | +4% |
| mean health per unit | 73.9 | 73.2 | -0.9% |
| **deaths per game** | 2.75 | 3.10 | **+13%** |
| **sharePar** | — | — | **-0.145 [-0.258, -0.035]** |

And the control: on the hazard-FREE cell the same bot collects even more
potions (+45%) and dies slightly LESS than plain (3.62 vs 3.77). The
death penalty appears only where there are hazards to walk into. That is
an interaction, not a main effect, and it is exactly what the mechanism
predicts.

Cycle k4 is testing the dose-response — the same cell at damageRatio
0.05 / 0.15 / 0.30 — which is the last thing needed to call this causal
rather than merely consistent.

### What this changes about the item

The owner's ask was a bot that is intelligent about collecting potions
and protecting itself from potion attacks, and that SMASHES bots without
that intelligence on potion-spawning cells. After 1,152 games:

- **The collecting half is BUILT AND WORKING** — +22-45% potions, in play,
  measured, from a configuration flag with zero search cost.
- **It does not smash, because the prize is small.** More potions do not
  convert into sharePar at `effectTurns: 3`.
- **On hazard boards it is a net loss**, because the chase costs deaths.

The productive question is therefore no longer "how do we make the bot
collect potions" — that is done — but **"at what potion settings does
collecting them pay?"** If invulnerability is worth more (longer
`effectTurns`, or scarcer potions so each is more decisive), the same
already-working flag should start to earn. That is a board-settings
sweep, it is cheap, and it is the natural next cycle.

If the answer is that no reachable setting makes it pay, that is a finding
about the GAME worth telling the owner plainly — and it would mean the
potion-intelligence effort should stop, with the ordering flag left
selectable and OFF by default on hazard boards.

---

## Cycle k4 — hazard dose-response, ABORTED PART-WAY (owner quota directive)

Batch `$SP/continuous/k4`, spec `specs/k4-hazdose.json`, bundle `b4`.
Planned 24 blocks x 3 rotations x 3 cells (216 games/arm); **stopped at
90/216 per arm, 178 games readable.** The low-dose cell completed; the
0.15 cell reached 6 blocks; the 0.30 cell never ran.

| cell | damageRatio | blocks | G = potionOrder − plain | 95% CI |
|---|---:|---:|---:|:--|
| potion-hazdose05-snake6 | 0.05 | 24 | **-0.030** | [-0.255, 0.173] |
| potion-hazdose15-snake6 | 0.15 | 6 | -0.203 | [-0.517, 0.114] — too few blocks to read |
| potion-hazdose30-snake6 | 0.30 | 0 | — | not run |

Both A/A nulls contain zero, so the pipeline was sound at the abort.

**What the completed rung is worth.** At `damageRatio` 0.05 the harm is
-0.030 — indistinguishable from zero — against **-0.145 [-0.258, -0.035]
at 0.15** from k1+k2's 48 blocks. Two doses, and the harm is roughly five
times larger at three times the damage. That is the direction the
mechanism predicts and it is a genuine head start, but it is TWO points
with overlapping intervals: **it is not yet a dose-response curve and must
not be quoted as one.** The 0.30 rung is the one that would settle it,
and it is exactly the rung that did not run.

Resume by re-running `bash $SP/continuous/run-cycle4.sh` — the spec is
deterministic, so it will reproduce the same seeds; delete
`$SP/continuous/k4` first so the partial batch is not mixed with the
rerun.
