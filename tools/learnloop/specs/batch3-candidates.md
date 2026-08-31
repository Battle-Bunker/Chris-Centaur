# Batch 3 — candidate experiment specs

**HAND-WRITTEN, AND NOT A GENERATED ARTEFACT.** `specs/batch2/` is emitted by
`bin/make-promotion-batch.js` from `promotion-ledger.json` and must be
regenerated rather than edited. This file is the other thing: a place for a
candidate experiment to be *specified in full* before anyone decides whether it
belongs in the ledger at all.

Nothing here is a ledger row. No status is moved, no measurement is recorded,
and no flag's `promotionMetrics` are edited by this file's existence. A
candidate graduates by someone adding it to `promotion-ledger.json` and
regenerating — this is the note that makes that a five-minute job instead of a
reconstruction.

**Two sources feed this file.** `MS1` was written from the search-layer
teardown's own build evidence. `R1`–`R9` come from the 20260830 sandbox program
— 660 live games across 7 cheap probes — and each one is here because a probe
FIRED and could not resolve, or because a probe was impossible and said so for
zero games. They are ranked; the ranking is the program's own and is reproduced
below with the reason each item earned its place.

---

## The ranking — what earns resources first, and why

From the 20260830 sandbox program. **Order is value per game, not
alphabetical**, and the list is meant to be cut from the bottom.

| # | item | games | why it is where it is |
|---|---|---|---|
| 1 | **R1** evaluator selection across a roster ladder, at the owner's shape | 1,152 | the only open item that changes **what ships** |
| 2 | **R2** block-count calibration for piece cells (folds in R6) | 1,440 | infrastructure every other piece-cell experiment depends on; sandbox-priced |
| 3 | **R3** P11 at 73 blocks | 1,314 | the branch merge decision, now with a measured power number instead of a guess |
| 4 | **R4** a second slate, then the potion doctrine race | 768 + a build | highest leverage per line of code in the queue |
| 5 | **R5** what the cluster enumeration buys | 384 + a branch | a fifth of the decision budget on piece boards, never priced |
| 6 | **R7** `gainOrdering` with the confound removed | 384 | a default-on strategy defended by an effect no larger than the noise |
| 7 | **R8** the knight anomaly | 192 + a free replay probe | small, and possibly a defect rather than a finding |
| 8 | **R9** multi-start with opening instrumentation | 384 | see also MS1 below, which specifies the same arm in full |

**RE-RANKED BY `20260831-batch2` (2,472 games), and three items are new.** The
batch's own headline is that no placement effect cleared its control anywhere;
what it bought instead is a set of *mechanism* facts, and they move the queue.

| # | item | games | why it moved |
|---|---|---|---|
| **NEW 1** | **B1** the first-plan latency on piece boards | **0 — it is a build, then a re-run of P16** | The search-arch build takes **343 ms (p90 527 ms)** to produce its FIRST plan on `headline-mix-king` against the baseline's **46 ms (p90 132 ms)** — 7.5×, and BUDGET-INDEPENDENT (343 / 311 / 326 ms at the 500 / 1000 / 2000 ms rungs). That is not slow anytime behaviour, it is a fixed setup cost paid *before anytime behaviour starts*, and it is why 100 of 100 deadline misses at 500 ms are misses on the first plan rather than late or stale ones. It is the enumeration (337 ms/decision on that board at that rung — the same number). **This is the highest-leverage item in the queue because it is the one thing measured that plausibly explains the branch's whole placement record, and because it is fixable in code rather than bought with games.** |
| **NEW 2** | **B2** the residual bank bounds inversion | **0 — replays already hold it** | Three thrown decisions, all `BoundsInversionError: inverted ScoreBounds ... bank floor=B0 ceiling=B3`, floor above ceiling by 1e-4 to 3e-4 relative. All on `snake5-queen`, ~1 in 104 games there and 0 elsewhere. The categorical fix (018d780, DEAD ceiling under a finite floor) is IN this build; this is the residual numerical case and wants a tolerance. `errors > 0`, `stagedNothing > 0` and `unstaged > 0` co-occur on exactly these three of 5,520 lobster game-seats, so the cost in play is a forfeited turn. **The `boundsInversions` counter recorded 0 on one of the games that threw** — the counter that names this failure does not count it, and it is retired. |
| **NEW 3** | **B3** floor every budget rung, and re-floor the headline board | ~576 | The A/A ran only at 2000 ms while P16's cells are named `<board>@<ms>`, so the 500 ms and 1000 ms rungs have **no floor at all** and their placement rows are UNREADABLE, not null. Separately: `headline-mix-king`'s `score` floor widened ×1.65 batch-on-batch — **and `null-snake6`'s wall-clock floor widened ×17.76**, which is why "it is not the box" does not survive flooring every metric instead of only `score`. |
| 3 → **2** | **R3** P11 at real power | **876** (was 1,314) | now affordable: one board, not three — see R3. |
| 5 → **4** | **R5** what the enumeration buys | 384 + a branch | batch 2 priced it per decision and found TWO cost regimes, not one — see R5. |

**R9 and MS1 are the same experiment seen from two sides** and must not be
scheduled twice. MS1 is the fuller specification — it carries the mechanism
metrics, the gate and the two build conditions — and R9 is the correction the
sandbox's live reading makes to it: ablate on ONE seat, and instrument the
OPENING claim rather than end states. Schedule MS1, with R9's two changes folded
in.

### The seating that makes most of these cheap

**Seat both sides in one game wherever the spec allows it.** The sandbox's
roster ladder resolved five rungs in 144 games because the contrast lived inside
each game; the same question through paired arms costs several times more. The
pattern is in `HANDOFF.md` on `sim/worker-kit` under *SEATING BOTH CONTENDERS IN
ONE GAME*, with its pairing semantics written out. In one line, the semantics
that matter here:

- The two arms are **identical** — it is an A/A pair, and it is **self-flooring**.
  One paired run buys the cell's A/A floor *and* the treatment reading at once.
- The reading is **G = sharePar(A) − sharePar(B)** per game, and **the floor to
  quote is the between-arm difference of G**, not either seat's own floor.
- `rotateSeats` must stay on, or G becomes a statement about board position.
- `sharePar` sums to the team count across seats, so G is mechanically
  anti-correlated between the two seats. Read it as a contrast, never as two
  independent effects.
- A within-game G measures A against B **in each other's presence**. Right
  instrument for "which should we field"; wrong one for "what would A score
  alone".

**It does not apply to R3.** A branch-versus-branch merge decision compares two
BUNDLES, which cannot share a board, so R3 is priced as a paired-arm run and
that is why it is the most expensive item on the list.

### The standing methodological requirements for batch 3

1. **Every piece-bearing cell carries its own A/A null at its own block count.**
   The sandbox proved an 8-block piece cell fails its own null (+0.271
   [0.037, 0.506] on identical bundles). A batch that assumes otherwise produces
   unreadable numbers at owner-shape prices.
2. **Prefer within-game contrasts to between-arm contrasts** wherever a spec can
   seat both sides.
3. **A bot config names the seat it configures.** `bot@<seat>=` on the kit
   branch; a bare `bot=` on a spec seating two configurable contenders is now a
   refusal. See the correction under R7 for what this did and did not cost the
   sandbox.
4. **Quote every delta against a floor measured on the same board, the same
   bundle and the same block count.** The same cell floored ±0.120 on one bundle
   and ±0.234 on the other in one night.

---

## MS1 — the multi-start seed, default bot vs `multistartSeed`

*The owner's search-seeding redesign: a literally random safe stage-0 baseline,
sampled multi-start hill climbing per cluster inside a slice of the decision
budget, and a weighted-random (softmax) selection among the combos found.
Built at `src/lobster/search/multistart-seed.ts`.*

**SELECTED BY `BotConfig.multistartSeed` (`src/lobster/bot-config.ts`), default
`false` — 20260830.** The flag `CENTAUR_MULTISTART_SEED`, the per-engine
override `TeamDecisionOptions.multistartSeed` and the `1|on|true` parser are
all deleted; the search-layer teardown moved this to a config field because it
is a genuine strategy alternative — it changes which starts the climb takes,
never a sound bound. An arm is `bot={"multistartSeed":true}`, declared as data
on the contender, and a bad value is a refusal from `botConfigFromJson` rather
than the silent off the flag gave. Setting the old variable in an arm's
environment now does **nothing at all**, which would play the shipped bot under
this candidate's name.

### Status going in

**Never raced.** Offline only: a gate test asserting flag-off identity, a
stage-0 safety property, stage-1 budget and per-seed determinism, and a
regression on a packed-corner fixture built from the P7 pinning numbers. It has
no live evidence of any kind, and the case for running it is that it is the
direct replacement for a flag this programme has already rejected live.

### The question

`CENTAUR_CLUSTER_SEED` is REJECT on measurement, and the root-cause pass named
the mechanism precisely: **surrogate-basin capture.** The seed handed rung 0 a
de-conflicted plan that was simultaneously a local optimum of the single-unit
ascent and accident-free, so `selfInflictedPairs` and `contestedUnits` came back
empty, `pairRepair` and `jointPolish` did nothing, `perturb`'s single-unit moves
lost on the floor, and the 2000 ms search spent itself re-deriving one plan —
**improving slices 0.2% against 37%, from turn 1**. The team's opening geometry
was then decided by a surrogate with no term for the board edge, free space or
dispersion, and it walked into the corner: own-team separation **10.70 → 6.51**,
wall distance **3.95 → 2.00**, mean wall distance below 2.0 by median turn 5 in
**48 of 48** games against 5 of 48, and from that state collision deaths
**46 → 220** per 48 games.

So MS1 asks one question in two halves:

> **Does the multi-start restore the climb the search is budgeted for, without
> reintroducing the compression?** That is: does the improving-slice rate in the
> opening turns come back to the un-seeded arm's level, and do own-team
> separation and wall distance stay at or above it?

A null on placement with the climb restored and the geometry flat is a **pass**
worth carrying forward; a null on placement with the climb still dead is the
same failure wearing a new name.

### Arms

| arm | configuration |
|---|---|
| `default` | the shipped bot, taken whole. |
| `multistart` | `--arm 'multistart=<bundle>,bot={"multistartSeed":true}'` |

**AIM THE CONFIG AT A SEAT — 20260830.** If this arm is redesigned as R9 below
requires, seating the ablation on ONE contender so the contrast is within-game,
then the spec seats two configurable contenders and a bare `bot=` is a refusal.
Write `--arm 'multistart=<bundle>,bot@<seat>={"multistartSeed":true}'`. The line
above is correct only for the two-arm shape as written here, where the spec
seats one.

**Both arms must be built from POST-TEARDOWN refs.** A pre-teardown bundle has
no bot-config module, ignores the config and plays the shipped bot — the silent
A/A that voided P5. `checkContenders` refuses that pairing.

Two arms, and deliberately not three. The temptation is to carry a `cl-seed`
arm for contrast; do not. The contrast already exists in P7 at the same cells
and the same seed sequence, the comparison that matters here is against the
UN-seeded arm, and a third arm buys a re-measurement of a rejected flag at a
third of the batch's box time.

**REQUIRES: both arms launched simultaneously**, on P7's 4×5-worker pattern.
P7 is the only experiment in the programme with weather symmetry by
construction and that is exactly why its rows are readable; every throughput and
slice-rate metric below is worthless without it.

### Cells — the P7 cells, with their standing caveats carried

| cell | role | caveat |
|---|---|---|
| `null-snake6` | **the readable cell.** Six trail units, trajectory-stable under zero treatment (A/A 44–45 of 48 games identical, paired turn-correlation +0.912 under a decision-preserving flag). The only P7 cell that resolved the seed's effect at all. | Runs at cap rate 0.917–1.000 in the un-seeded arm — a stall rather than play. The mechanism metrics below are non-placement measurements and survive that; `score` on this cell carries the standing uninterpretability caveat and must not be reported unqualified. A named long-cap snake cell would fix this and does not exist yet. |
| `snake5-knight` | **the piece-bearing falsifier.** It is what killed the board-level admission gate for the rejected seed: a piece board where that seed paid full price and bought nothing. | On the complete death breakdown this cell is flat, so it discriminates weakly. Carried as a falsifier, not as a scoring cell. |
| `headline-mix-king` | **description only.** | DISQUALIFIED as a scoring cell on measurement, not preference: under zero treatment its A/A pair agrees on game length in 5 of 48 games (turn-correlation −0.193) and flips 26 of 48 placements. It cannot resolve this effect at n=48. Include it only if the batch has box time to spare, and never score it. |

Blocks and games/arm should match the P7 pattern the comparison rests on
(16 blocks; 144 games/arm at three cells, 96 at two). N0 must floor every
scored statistic on every scored cell — batch 1's lesson, paid for twice.

### Mechanism metrics — what this experiment actually reads out

Placement is the *outcome* and is not the instrument. The four rows below are
the mechanism, they are what the P7 analysis measured, and they are what makes a
null interpretable instead of silent.

1. **OWN-TEAM SEPARATION.** Mean pairwise Manhattan distance between the
   subject team's heads, per turn, **controlled for survivorship** — only turns
   where both paired games still have the full roster alive, which is how
   10.70 → 6.51 was measured over 949 matched full-strength turn-pairs. A
   drifting mean over a shrinking team measures attrition, not formation.
   - *Expected under a pass:* flat against `ms-off`. The multi-start's objective
     carries no spacing, boundary or follow-the-tail term, so it has no
     mechanism by which to compress.
   - *Refuse the arm if:* separation falls by more than 1 cell. That is a
     quarter of the rejected seed's contraction and there is nothing in the
     design that should produce it.

2. **WALL DISTANCE.** Mean distance from the subject team's heads to the
   nearest board edge, per turn, same survivorship control. Report the **turn
   trajectory**, not the game mean: the rejected seed's signature is that
   `ms-off` bottoms out around turn 3 and **recovers monotonically** (3.20 →
   2.78 → 4.24) while the seeded arm falls monotonically and never recovers.
   Also report the headline count directly — **first turn at which team mean
   wall distance < 2.0, and in how many of 48 games it ever happens** (48/48 at
   median turn 5 under the rejected seed; 5/48 without).
   - *Note before reading turn 1 in isolation:* a uniform draw over safe moves
     loses wall distance near a corner as a matter of geometry — from a cell at
     distance 2 on the diagonal, two of four neighbours are at distance 1. A
     one-turn dip is not pinning. **Pinning is the monotone failure to
     correct**, and the recovery is the measurement.

3. **COLLISION DEATHS.** The full `ClashKind` vector, subject team, mined from
   replays: `contest`, `edge`, `bodyBlock`, `wall`, `self`, plus `exhaustion`,
   `hazard`, `sever`, `regicide`. **Not fatal stagings, and not a single key.**
   Report the COLLISION aggregate `{contest, edge, bodyBlock, wall, self}`
   beside the per-cause split, and reconcile the total against units lost
   (6 per game minus `finalUnits`) as an extraction check — that reconciliation
   is what closed `DEATH-CAUSE-SINGLE-KEY` and it costs nothing.
   - *The standing process finding this row exists to honour:* any future
     seed/ordering flag must be gated on a live cause-of-death breakdown, on a
     trajectory-stable cell, and never on offline fatal stagings. The rejected
     seed passed an offline gate at 41 → 0 and went 46 → 220 live on the same
     channel, a 4.8× miss on the exact quantity the gate measured.
   - *A/A floor:* the null pair moves the collision channel by ~2 units across
     48 games. Anything inside that band is noise and must be reported as such.

4. **REFUSAL RATE.** Two different things, both counted, and they must not be
   summed:
   - **Kernel refusals** — `ratchetRate` per decision, plus the emission-gate
     counters (`worth`, `rate`, `switch-floor`, `switch-dominance`,
     `ratchet-floor`, `ratchet-gap`, `nonconforming`). Read these knowing they
     are a LATE signal: under the rejected seed `ratchetRefusals` is 0.00
     through turn 60 and the "+103% plans with 10× refusals" shape first appears
     at turns 31–40, roughly thirty turns downstream of the pinning. A flat
     refusal rate in the opening turns is not evidence of health.
   - **Layer-internal refusals** — the multi-start's own report:
     `stage0Clean`, `stage0Conflicts`, `stage0Forced`, `stage0Coordinated`,
     `truncated` (pools the clock cut short), `samples`, `evaluations`,
     `spentMs` against `budgetMs`. A `stage0Forced` above zero means units with
     no survivable option; a persistently high `truncated` means the sampler is
     mis-sized for the box and its sample count should be re-derived, not
     quietly tolerated.

### The primary signature — and it is not on the list above

**IMPROVING-SLICE RATE IN THE OPENING TURNS.** Slices that produced a genuinely
better plan, as a fraction of slices, subject team, turns 1–5, at equal plan
counts. This is the causal telemetry: **0.2% under the rejected seed against
37% without it, visible on turn 1**, thirty turns before any refusal counter
moves. Everything in the mechanism list is downstream of it.

- *Gate:* **REFUSE THE ARM** if the multi-start's opening improving-slice rate
  is not restored to within the A/A band of `ms-off`'s. A seeding layer whose
  start the search cannot climb away from has reproduced the failure it was
  built to fix, and reporting that as a placement null would repeat the exact
  error P7 cost the programme.
- Report `plansEvaluated` per decision beside it, under the standing
  retirement: it carries a verdict ONLY with simultaneous launch AND a same-cell
  A/A floor for the same statistic. Batch 1's A/A pair swung it +65% under zero
  treatment.

### Two conditions the build already carries, which the arm should confirm live

Both come out of the root-cause pass and both are testable from the same run:

1. **Team-scale diversity.** Stage 0 re-draws every unit AND the order they are
   placed in, so the starts differ at team scale rather than by one unit —
   `perturb` is already a one-unit multi-start and is measurably useless here.
   Confirmed live by the seeding's own variance across the decision seed.
2. **The multi-unit repair operators stay armed.** Stage 0's common clause does
   NOT de-conflict (the safety floor and de-confliction are different things,
   and only the first is owed), and `jointPolish` additionally takes units from
   a room/dispersion gate rather than only from the resolver's accident report.
   Confirmed live by `pairRepair`/`jointPolish` engagement counts being non-zero
   in the opening turns on `null-snake6`.

### What must NOT be carried into this arm

The rejected seed's `EPS_FOLLOW` (+0.06 tail-follow bonus against a 0.05
ordering step). It took landings on a team-mate's freed tail from 0.3% to 26%
and converted a drifting formation into single file, which is why separation
fell rather than rose. It is an amplifier and not the driver — the lowest-follow
tercile of games is still pinned at wall 2.33 against 3.82 and still carries five
times the collision deaths — but it amplifies exactly this failure and there is
no version of this experiment in which adding it back is informative. The
multi-start's objective has no such term and must not gain one.

### Denomination

Every prior and every charge in this layer is in **weight units** — the material
lattice itself, where a unit of weight `w` dying is exactly `−w`. Heuristic
outputs tether to expected weight/score impact directly. Any readout that
introduces a second scale for these numbers is a readout to fix, not to
interpret.

### Also worth one line in whatever batch runs this

**`CENTAUR_EDGE_EV` composes with this arm and should not be entangled in it.**
The multi-start reads the edge-EV unary priors as its softmax weights where the
pass has run and treats every option as equal where it has not, so `ms-on` with
edge-EV off is the uniform-prior configuration and `ms-on` with edge-EV on is a
different experiment. Run MS1 with edge-EV at its shipped default and leave the
composition to a later joint arm; a feature folded into a neighbour's flag can
only ever be measured as a sum.

---

# R1–R9 — the 20260830 sandbox program's roster

660 live games, 7 probes, 15×15 / 3 teams × 6 / 250 ms / turnCap 60 unless a
line says otherwise. Bundles: `baseline` = `66904d2`
(`claude/mid-turn-collision-logic-mkxurg`, the validated baseline, which has no
`src/lobster/bot-config.ts` — defaults-only arms there), `feature` = `c74f0a1`
(`claude/cluster-lookahead`, the search-architecture branch, which carries it).
Game counts are **per batch, both arms**, at the owner's shape unless stated. A
"block" is one seed through all three seat rotations = 3 games.

---

## R1. Is `lobster-territory` the right default evaluator on piece-bearing rosters?
**RANK 1 — the highest-value experiment on this list.**

**Question.** The shipped default evaluator is territory. The sandbox measured
its advantage over material at **+1.39 sharePar on all-snake boards** and
**0.00 to −0.47 as soon as any piece is fielded**. The owner's regime is mostly
snakes, which is to say: mostly the rosters where the advantage is present — but
`mix-king`, the headline roster, is not, and it is untested.

**Why it survived the cheap probe.** It did not merely survive; the probe fired.
Two independent builds (`66904d2` and `c74f0a1`) agree to within 0.07 sharePar
on both endpoints. A five-rung ladder places the transition at **one piece of
any class**:

| roster | G = sharePar(territory) − sharePar(material) | A/A floor on G |
|---|---|---|
| 6 snakes | **+1.392 ± 0.336** | +0.193 ± 0.335 |
| knight + 5 snakes | −0.058 ± 0.355 | +0.121 ± 0.446 |
| rook + 5 snakes | +0.134 ± 0.334 | +0.317 ± 0.378 |
| queen + 5 snakes | +0.018 ± 0.526 | −0.095 ± 0.233 |
| 2 queens + 4 snakes | **−0.465 ± 0.284** | −0.057 ± 0.558 |

**The knight row is the decisive one.** A knight has no ray and no reach, and it
kills the advantage as completely as a queen does. So the earlier mechanism
story — "a long-range slider turns held ground into a killing field" — is
**retracted**: reach is not the variable, and the slider-detector premise is
invalidated as the causal axis. What remains untested is piece weight class, the
fact that a piece is a single-tile unit with no tail to block with, and its
eligibility as a target under the head-kill channel.

**What the probe could NOT do** is resolve each rung. Every G except the
all-snake row sits within about 1.5 floors of zero, and the two-queen reversal
does not clear its own floor's uncertainty (directionally consistent across both
arms, −0.493 and −0.436, which is reassuring and is not a result). What the
ladder establishes is the CONTRAST BETWEEN ROWS — snake against
anything-with-a-piece, 1.4 sharePar, about 4× the floor.

**Two different failure modes, not one.** Reading the whole seat table rather
than only the contrast separates them:

| cell | territory | material | reflex | territory : reflex |
|---|---|---|---|---|
| 6 snakes | 2.14 | 0.72 | 0.12 | 18 : 1 |
| knight + 5 snakes | 1.18 | 1.24 | 0.58 | **2 : 1** |
| rook + 5 snakes | 1.48 | 1.35 | 0.17 | 9 : 1 |
| queen + 5 snakes | 1.49 | 1.47 | 0.04 | 37 : 1 |
| 2 queens + 4 snakes | 1.26 | 1.72 | 0.02 | **63 : 1** |

The knight board is **not skill-expressive** — everything compresses toward par
and reflex closes most of the gap, which is why its floor on G is the widest in
the ladder (see R8). The queen boards are **highly skill-expressive** and
territory is simply the wrong evaluator there — reflex is crushed 37:1 then
63:1, so the engine is doing enormous work and it is the territory *valuation*
specifically that loses its edge and then falls behind. The second is the
serious finding; it cannot be dismissed as board noise.

**Arm shape.** ONE arm pair of IDENTICAL bots — self-flooring — with the spec
seating `[lobster-territory, lobster-material, reflex]` so the contrast is
within-game. Six cells, ONE axis (roster) only, potions ON + hazard `cross`, at
the owner's shape 25×25 / 3 teams × 6 / 2000 ms / turnCap 120: `snake6`,
`snake5-knight`, `snake5-rook`, `snake5-queen`, `queen2-snake4`, `mix-king`.
**32 blocks per cell** — and see R2, because four of those six are piece cells
and 32 may not be enough for them.

**Expected games.** 6 cells × 32 blocks × 3 rotations × 2 arms = **1,152 games.**

**What changes as a result.** If the ladder holds at owner scale, the evaluator
is a **per-roster selection** rather than a global default. That is a
collection-lane question — adding or selecting a member is a normal commit — and
it is the most consequential one open.

**Caveats the sandbox states against itself.** 15×15 is small and a piece's
influence per tile is larger there than at 25×25; that cuts against the finding
and is the first thing to re-measure at scale. One piece count per class, no
king, one board size, one budget, one hazard layout, one potion rate.

---

## R2. Block-count calibration for piece-bearing cells
**RANK 2 — infrastructure every other piece-cell experiment depends on. Folds in R6.**

**Question.** How many blocks does a piece-bearing potions-ON cell need before
its A/A null contains zero?

**Why it is here.** Not because a probe survived — because a probe **FAILED**,
and that is the finding. On the feature bundle at 8 blocks the A/A null on a
queen cell was **+0.271 [0.037, 0.506]: it excludes zero.** Nothing measured on
that cell at that size is readable. Snake cells at the same size floor cleanly.
The full measured floor set, subject `lobster-territory`, n = 8 blocks:

| cell | bundle | sharePar A/A floor |
|---|---|---|
| potions off, no hazard, snakes | baseline | +0.041 ± 0.097 |
| potions ON, hazard, snakes | baseline | −0.093 ± 0.159 |
| potions ON, hazard, queen | baseline | +0.053 ± 0.120 |
| potions ON, hazard, snakes | feature | −0.064 ± 0.099 |
| potions ON, hazard, queen | feature | **+0.271 ± 0.234 EXCLUDES ZERO** |
| knight + 5 snakes | baseline | −0.064 ± 0.242 |
| rook + 5 snakes | baseline | −0.141 ± 0.224 |
| 2 queens + 4 snakes | baseline | +0.042 ± 0.274 |

Nobody knows where the crossover is, and until somebody does, every piece-cell
block count in batch 2 and batch 3 is a guess. The extrapolation from the widest
point — 8 × (0.234/0.10)² ≈ **44 blocks** — is the number batch 2's specs are
annotated with, and it is an extrapolation from ONE point, which is exactly why
this run exists.

**Arm shape.** A/A pairs (same bundle, same config, two names) on ONE piece cell
— `snake5-queen`, potions ON, hazard `cross` — at **8 / 16 / 32 / 64 blocks**,
reporting floor half-width against block count. Run on BOTH bundles, because the
two disagreed and the reason matters (that is R6). Seeds nest, so the four rungs
are one nested sequence rather than four experiments.

**Expected games.** (8+16+32+64) × 3 rotations × 2 arms × 2 bundles =
**1,440 games.** Cheap per unit at sandbox shape: run it there first, then
confirm the curve's shape at owner scale on the 32-block point only.

### R6, folded in — is the feature branch NOISIER on piece boards?

A variance question, not a mean question, and it costs almost nothing on top of
R2's design. The baseline bundle floored the queen cell at ±0.120 and the
feature bundle did not (±0.234, excluding zero). The feature branch spends a
variable slice of an anytime budget on the deep layer and the enumeration, which
would produce exactly that. **If true it is a merge consideration in its own
right: a branch that scores the same but scatters more is worse.** The probe was
underpowered by construction — a variance ratio at 8 blocks is close to
uninformative — and on the all-snake cell the ordering REVERSED (feature ±0.099
against baseline ±0.159). It is a hypothesis, explicitly not a verdict. Compare
the two bundles' A/A pairs on SPREAD rather than mean, same cell, same seeds,
32 blocks. Games: shared with R2.

---

## R3. P11 at real power — the branch merge decision
**RANK 3.**

**Question.** Does the search-architecture branch `claude/cluster-lookahead`
beat the validated baseline `claude/mid-turn-collision-logic-mkxurg`?

**Why the probe was underpowered BY CONSTRUCTION.** The sandbox preview returned
**−0.01 [−0.31, +0.29] sharePar** — a null whose interval is three times the A/A
floor, so it cannot tell "no effect" from "an effect of 0.3". Critically it is
**not a dead arm**: the branch ran 800 scout threads, 370 scout plies and 2,873
cluster joints per game. *Engaged and did not help* is a real reading; *engaged
and unresolved* is what this actually is.

**The power number the preview exists to give.** Cross-bundle paired spread was
±0.303 at 8 blocks; half-width scales as 1/√blocks, so
**8 × (0.303/0.10)² = 73 blocks per cell** to resolve to the ±0.10 the floor
supports. That number is now in the ledger on `CENTAUR_SCOUT`'s `nextExperiment`
as a POWER block, and batch 2's `p11-scout.json` carries it with a REQUIRES line
saying what a 16-block run may and may not claim.

**WHAT BATCH 2 ADDED, AND IT CHANGES THE PRICE.** `20260831-batch2` ran this
exact pair for real — 144 paired games, 0 dropped, 16 blocks on three boards —
and the reading is *engaged, and undecidable at this size*: sharePar
−0.3945 [−0.9507, +0.1617] / −0.6343 [−1.2607, −0.0080] / −0.0684 [−0.2355,
+0.0987] on `headline-mix-king` / `hazard-mix-king` / `null-snake6`, every one
inside its own control band, with observed half-widths of ±0.556 and ±0.626 on
the two piece boards. The sandbox's 73-blocks-per-cell prediction is confirmed
by measurement rather than extrapolation. **The merge is NOT decided and the
three negative signs are not evidence against the branch** — a true +0.2 sits
comfortably inside those intervals.

**THE CHEAPEST DECIDABLE READ IS ONE BOARD, AND IT IS `null-snake6`.** Blocks
scale as (spread/target)², so the whole cost is set by the board's dispersion —
and batch 2 floored all three: `null-snake6` at ±0.1172 sharePar against
±0.7413 and ±0.7893 for the two mix-king boards, a factor of six. Reading the
merge on the mix-king boards is the entire reason this is a 1,314-game line
item.

| shape | games | box time | decides? |
|---|---|---|---|
| **`null-snake6` alone at 73 blocks + its own A/A at 73** | **876** | **~5 h** | yes, to ±0.10 on that board |
| three boards at 73 blocks + A/A | 2,628 | ~2.9 nights | yes, on all three |
| what batch 2 ran (16 blocks, 3 boards) | 288 | ~1.5 h | **no, in either direction** |

**The cost of narrowing, stated rather than buried.** `null-snake6` is where the
branch is engaged but least loaded — 388,220 cluster joints a game against
14,592,634 on `headline-mix-king` — so it is the board where the branch has the
*least* room to help. A null there does not license a null on the owner's board.
It answers the branching policy's question (does the search architecture pay for
itself where it can be measured) and not the owner's board's question. If the
answer must be about `headline-mix-king` specifically, no affordable read exists
at this class of budget and the honest move is to **fix the board first** — its
sharePar floor is ±0.74 and two batches now agree it resolves nothing.

**ALSO OWED, AND CHEAP: a second A/A on the BASELINE bundle.** The A/A null is
two *search-arch* builds by the kit's shared-bundle convention, so P11's
baseline arm has no floor of its own and the merge is read against the
challenger's noise. One extra A/A pair on the same single cell closes it.

**Arm shape.** `baseline` against `feature`, both shipped defaults, no bot config
on either side, **one cell (`null-snake6`) at 73 blocks** for the affordable
read — three cells only if 2.9 nights are being spent — potions ON + hazard
`cross` where the cell carries them.

**Expected games.** One board: 73 × 3 × 2 = 438, plus 438 for its own A/A =
**876 games (~5 h)**. Three boards: 1,314 + 1,314 = **2,628 games (~2.9
nights)**. **This is the one item on the list that cannot use within-game
seating** — two branch tips cannot share a board.

**Also measured, and unpriced.** Cluster enumeration costs **2,985 ms/game on a
queen board** against 535 ms on snakes — at 60 decisions × 250 ms that is ~20%
of the whole decision budget on piece boards, against 3.5% on snakes — and **no
configuration can turn it off**. That is R5.

---

## R4. A second slate — the unblock, then the potion doctrine race
**RANK 4, and it is a BUILD before it is an experiment.**

**Question.** Do the attack-window, potion-seek, potion-control and
dodge-discount entries improve play?

**Why it is here: the probe was IMPOSSIBLE, and it cost zero games to find out.**
`SlateId` has exactly one member; `LEGACY_SLATE.evaluators` is
`[EVAL_LEGACY_TERRITORY]`; the four potion entries are in **no slate** and
nothing outside their own tests imports them. **No `BotConfig` on either branch
can seat a bot that reads potions.** Consequences, stated plainly:

- The dodge-discount lineup experiment is **unrunnable as specified**.
- **Every potion arm in batch 2 and batch 3 is unrunnable** until a second slate
  exists.
- The seeded "is the territory verdict potion-blind?" hypothesis is
  **disconfirmed as posed** — potions on plus hazards left the all-snake verdict
  intact (+1.39 against +1.55 in the corpus regime) — and this is why: the bots
  never read potions, so a potion is scenery.

**Prerequisite.** A second `SlateId` member whose `evaluators` list includes the
potion entries, plus its `slateFor` case. Adding a member to a collection is a
normal commit under the collection lane. **This is the single
highest-leverage unblock in the queue**: it converts four already-built,
already-retrodicted modules from unmeasurable to raceable in one step.

**Arm shape once unblocked.** `bot@<seat>={"slate":"<new>"}` against the shipped
slate, on potions-ON cells at BOTH roster classes, 32 blocks, plus the dodge
sub-arm (with and without the discount consuming `CollectorExposure`) as a
second pair.

**Expected games.** 2 cells × 32 blocks × 3 rotations × 2 arms × 2 comparisons =
**768 games**, after the build lands.

**An interim option that needs no build.** The harness-only seam
`TeamDecisionOptions.evaluate` can seat a potion-aware evaluator directly as a
named contender. That yields a finding about a **capability**, not about a
deployable configuration, and **must be labelled so**. Worth ~192 games as a
go/no-go before paying for the slate work.

---

## R5. What does the cluster enumeration buy for a fifth of the budget?
**RANK 5 — a cost nobody has priced, and it cannot be turned off.**

**Question.** The enumeration costs a fifth to a quarter of the whole decision
budget on piece boards, spent before any strategy runs. What does it return?

**BATCH 2 MEASURED THE COST PER DECISION, AND IT KILLS THE "PIECE BOARDS ARE
EXPENSIVE" FRAMING.** From 2,472 games, `clusterEnumMs` per decision on the
search-arch build:

| board | roster | ms/decision | share of a 2000 ms budget | joints/decision | **ms per joint** |
|---|---|---|---|---|---|
| `null-snake6` | 6 snakes | 18.3 | 0.9% | 41.0 | 0.45 |
| `snake5-knight` | 5 snakes + **knight** | **18.0** | **0.9%** | 42.5 | 0.42 |
| `snake5-queen` | 5 snakes + **queen** | **223.8** | **11.2%** | 52.9 | **4.23** |
| `hazard-mix-king` | mixed + king | 422.5 | 21.1% | 2,489.6 | 0.17 |
| `headline-mix-king` | mixed + king | 474.5 | 23.7% | 2,471.1 | 0.19 |

**A KNIGHT COSTS NOTHING. A QUEEN COSTS TWELVE TIMES A KNIGHT.** The knight
board is indistinguishable from the all-snake board on both cost and joint
count. The queen board costs 12× the knight board on 1.25× the joints — so its
cost is not *more* clusters, it is *bigger* ones: a slider's reach makes each
residual cluster large and the exact small-cluster enumeration inside it
explodes. The mix-king boards are the opposite regime: 47× the joints at a
twentieth of the cost each.

**So there are two distinct cost regimes and they want different remedies.**
A *slider* regime (`snake5-queen`, 4.23 ms/joint — ten times any other board)
wants a cluster-size bound. A *crowd* regime (mix-king, 0.19 ms/joint but 2,500
joints) wants a cluster-count bound. `BotConfig.search.clusterEnum:false` skips
the partition wholesale and is the wrong instrument for either.

**AND IT IS WHERE THE THREE DECISION ERRORS LIVE.** All three thrown decisions
in batch 2 are `BoundsInversionError` on `snake5-queen` — the board with ten
times the per-joint enumeration cost, i.e. the deepest accumulation chains in
the batch — with the floor above the ceiling by 1e-4 to 3e-4 relative. The cost
regime and the numerical-soundness defect are the same finding seen twice.

**Why it survived.** It was measured as a side-effect of R3 and never as a
target. `CENTAUR_CLUSTER_ENUM` was deleted with no replacement, and
`botConfigFromJson` refuses a `clusterEnum` field by name, so **no configuration
can ablate it**. The cost is known; the benefit has never been raced. This also
subsumes the withdrawn `P8/P9-joint` row: there is no bundle in which the
enumeration runs and the branch does not.

**Arm shape.** A `feature/enum-ration` branch cut from the primary that bounds
or removes the enumeration, raced against the primary. Piece cells, where the
cost is concentrated. 32 blocks.

**Expected games.** 2 cells × 32 × 3 × 2 = **384 games**, after the branch exists.

---

## R7. `gainOrdering`, with the confound removed
**RANK 6.**

**Question.** Is `gainOrdering` — default ON everywhere, validated on
potions-off hazard-free mechanism evidence — worth its default?

**Why the probe was underpowered.** The only clean effect was reflex sharePar
**+0.058 [0.005, 0.111]** against a ±0.06–0.08 floor: it sits ON the floor, not
above it. The owner's-environment cell read −0.042 [−0.131, +0.048] and the two
intervals overlap heavily, so **no regime difference is established**. The
mechanism story did reproduce — removing gainOrdering raises contest deaths in
both cells, +0.29 and +0.25 — but the size does not justify the confidence the
default implies.

> **CORRECTION, and it matters for how this arm is redesigned.** The sandbox
> recorded a second reason: "the arm's `bot` config is merged into EVERY lobster
> contender, so both lobster seats lost the knob and the subject-seat comparison
> largely cancels." **That is what the code comment said; it is not what
> happened.** The per-seat `mechanism.flags` stamps in the c5 and c6 manifests
> show `gainOrdering:false` and `multistartSeed:true` on the `lobster-territory`
> seat ONLY, with `lobster-material` untouched in both arms — because the merge
> loop reached `lobster-territory` and declared contenders and nothing else, and
> those specs declared none. **So the cancellation confound did not occur, the
> subject-seat readings above are genuine one-seat ablations, and the reason the
> probe could not resolve is power alone.** The defect the sandbox named is
> nonetheless real for any spec seating two or more configurable contenders —
> which is precisely the design this entry and R9 recommend — and it is fixed on
> `sim/worker-kit`: a config now names its seat, and a bare `bot=` on such a spec
> is refused. Read the correction as *narrowing* the finding, not withdrawing it.

**Arm shape.** Ablate on ONE seat via a named contender so the contrast is
within-game, and aim the config at that seat by name:

```json
"contenders": { "noGain": { "base": "lobster-territory",
                            "bot": { "candidates": { "gainOrdering": false } } } },
"bots": ["noGain", "lobster-territory", "reflex"]
```

```sh
--arm 'treat=<bundle>,bot@noGain={"candidates":{"gainOrdering":false}}'
```

Two cells (potions-off flat, and potions-ON + hazard), all-snake, 32 blocks.
Within-game pairing should cut the required blocks by roughly half again.

**Expected games.** 2 × 32 × 3 × 2 = **384 games.**

---

## R8. Why is the knight board not skill-expressive?
**RANK 7 — small, and possibly a defect rather than a finding.**

**Question.** On `snake5-knight`, reflex closes to 2:1 against both lobster bots
(sharePar 0.58 against 1.18 and 1.24), while on every other roster it is crushed
9:1 to 63:1. Either knight boards are genuinely chaotic, or the candidate layer
handles knights badly.

**Why it survived.** Observed once, at 8 blocks, on the widest A/A floor in the
ladder (±0.45 on the contrast). A single suspicious cell — and the kind of cell
that usually turns out to be a bug.

**Arm shape, and NO RACE IS NEEDED FOR THE FIRST LOOK.** Take knight positions
out of the sandbox replays, fix a plan, and inspect the generated candidate set
for the knight unit under an unbounded budget. If the move set is wrong, that is
a defect with an address, not a finding about boards. **Cost: zero games.** Only
if the move set is sane does this need 16 blocks of `snake5-knight` and
`snake5-pawn` — a second non-slider piece — to see whether the compression is a
knight fact or a non-slider-piece fact.

**Expected games.** 2 × 16 × 3 × 2 = **192 games**, plus the free replay probe.

---

## R9. Multi-start seed — measure the claim it actually makes
**RANK 8. See MS1 above, which specifies this arm in full; R9 is the correction
the live reading makes to it. SCHEDULE ONE, NOT BOTH.**

**Question.** Does `multistartSeed` deliver the OPENING DIVERSITY it claims?

**Its first live reading, and it is not encouraging.** It costs **113 extra
scout threads and 63 ms of enumeration per game** and, on the one cell where
anything was measurable, hands the weakest opponent more board: reflex sharePar
**+0.093 [0.012, 0.174]** against a ±0.06–0.08 floor, with reflex survival and
final units moving the same way. The second cell read a null of the opposite
sign. So: expensive, and either neutral or harmful.

**But the run measured END STATES and the feature's claim is about OPENINGS.**
No opening-phase quantity was instrumented at all, so the claimed benefit was
never given a chance to appear. The arm needs redesigning before it is judged.

**The two changes from the sandbox design.**

1. **Ablate on ONE seat** via a named contender, aimed with `bot@<seat>=`, so
   the contrast is within-game.
2. **Instrument the CLAIM.** Opening separation over the first ~10 turns (mean
   pairwise distance between own units, and distinct-cell coverage), plus early
   collision deaths, reported as the PRIMARY rows with sharePar secondary. MS1's
   mechanism list is the fuller version of this and should be used as written.

Packed-spawn snake cells, where an opening sampler has the most to offer,
32 blocks.

**Expected games.** 2 × 32 × 3 × 2 = **384 games.**

**Note.** If the opening instrumentation cannot be added without touching bot
source, take it off the replays instead — the positions are already on disk and
no race is needed to measure separation.

---

# The three items `20260831-batch2` added

Written in the same shape as R1–R9. Two of them cost **no games at all** — the
batch already holds the evidence and what is owed is a code change — which is
why they rank above everything that has to be bought with box time.

## B1. The first-plan latency on piece boards
**NEW RANK 1. A BUILD, then a re-run of P16 to confirm it.**

**Question.** The search-architecture build takes 7.5× longer than the baseline
to produce its *first* staged plan on the owner's board. Can that setup cost be
made incremental, and does the branch's placement record change when it is?

**The measurement, from 2,472 games.** Time to first staged plan,
`lobster-territory`, by build and budget rung:

| board | rung | baseline p50 / p90 / max | search-arch p50 / p90 / max |
|---|---|---|---|
| `headline-mix-king` | 500 ms | 46 / 132 / 475 | **343 / 527 / 1123** |
| `headline-mix-king` | 1000 ms | 31 / 102 / 962 | **311 / 469 / 1080** |
| `headline-mix-king` | 2000 ms | 38 / 111 / 590 | **326 / 492 / 1462** |
| `null-snake6` | any | 2 / 4 / ~12 | 16–17 / 25–26 / 68–95 |

**Two things make this the sharpest finding in the batch.**

1. **It is budget-independent.** 343 / 311 / 326 ms across three budgets is a
   fixed price, not a share. An anytime kernel whose first plan costs a constant
   ~340 ms has *no anytime behaviour at all* below that, which is exactly what
   the deadline data shows: at the 500 ms rung, **100 of 100 overrunning
   decisions had `firstStageMs > budget`** (median 560 ms), and at 1000 ms only
   4 of 23 did. The breach is a threshold, not a gradient.
2. **It degrades in the one way that is not a bug.** `emissions == 0` on **0 of
   100** overrunning decisions — the kernel never returns nothing and never
   stages a stale plan. Every miss is *a move, late*. The baseline overran zero
   decisions at every rung.

**Where the cost is.** `clusterEnumMs` on `headline-mix-king` at the 500 ms rung
is **337 ms per decision**, which is the first-plan latency to within rounding.
The setup cost *is* the cluster enumeration, which is R5's subject and cannot be
turned off by any configuration.

**What is owed.** Make the first plan available before the enumeration
completes — a cheap admissible plan staged immediately and refined, rather than a
partition that must finish before anything is emitted. That is a change to the
decision path and belongs to the architecture lane.

**Expected games.** **Zero to specify it.** Confirming it is a re-run of the P16
ladder on a quiet box, ~576 games with the rungs floored (B3).

**Read this next to R3.** If the branch's placement record is shaped by a
340 ms setup tax on piece boards, then buying 876 games to decide the merge
*before* the tax is addressed may be buying a decision about the wrong build.
**B1 should land before R3 runs.**

---

## B2. The residual bank bounds inversion
**NEW RANK 2. ZERO GAMES — the replays already hold it.**

**Question.** Why does one decision in ~104 games on `snake5-queen` throw
`BoundsInversionError` and forfeit its turn?

**The three instances, and they are one defect.**

| arm / game | turn | thrown bounds | gap | relative |
|---|---|---|---|---|
| `nullA` / `snake5-queen-s54506-r1` | 105 | `[149.7698, 149.7502]` | 0.0196 | 1.3e-4 |
| `default` / `snake5-queen-s69705-r0` | 78 | `[60.0150, 60.0000]` | 0.0150 | 2.5e-4 |
| `sampled-cap` / `snake5-queen-s69711-r1` | 103 | `[251.3184, 251.2998]` | 0.0186 | 7.4e-5 |

All three: `bank floor=B0 ceiling=B3`, tag `[bounds_inversion]`, `emissions: 0`,
`overrunMs: 0`, wall time 89–175 ms against a 2000 ms budget. **It did not time
out and it did not play illegally — it threw, early, and emitted nothing.**

**Root cause, and it is not the one already fixed.** The floor exceeds the
ceiling by three to four orders of magnitude less than the quantities being
compared. That is a floating-point accumulation signature: B0 and B3 are reached
by different accumulation paths and their rounding diverges. The *categorical*
case — a DEAD ceiling under a finite floor — was fixed at `018d780` and that fix
**is** in this build (`b68ce98` descends from it). This is the residual
*numerical* case and wants an epsilon at the comparison, not a rewrite.

**Why `snake5-queen` and nowhere else.** It is the board with **4.23 ms of
enumeration per cluster joint — ten times any other board** (R5) — i.e. the
deepest accumulation chains in the batch. Cost regime and soundness defect are
the same fact seen twice.

**Not arm-specific.** One of the three is `nullA`, an untreated build.

**The instrument gap, which is the part worth fixing first.**
`nullA/snake5-queen-s54506-r1` threw a `BoundsInversionError` and recorded
`boundsInversions: 0`. **The counter that names this failure does not count the
instance of it that killed a decision** — and the counter is RETIRED, so nothing
is watching it either. Whatever increments `boundsInversions` is not the throw
site. Fix the counter before trusting any future reading of it.

**Blast radius.** Exactly one forfeited turn per occurrence: over 5,520 lobster
game-seats, `errors > 0`, `stagedNothing > 0` and `unstaged > 0` are true on the
same three seats and no others. All three games were still won by the affected
bot, so this is a soundness defect rather than a strength defect — but a decision
path that can throw is a decision path that can throw at a worse moment.

**Expected games.** **Zero.** A unit test from the three recorded bound pairs.

---

## B3. Floor every budget rung, and re-floor the headline board
**NEW RANK 3. ~576 games, and it is the precondition for reading P16 at all.**

**Question one: what is the noise floor at 500 ms and at 1000 ms?** Nobody
knows. The A/A null ran only at 2000 ms, and P16's cells are named
`<board>@<ms>`, so the 500 ms and 1000 ms rungs have **no floor of their own**.
Their placement rows are **UNREADABLE, not null** — and the 2000 ms floor may
not be lent to them, because *that noise differs with budget is the experiment's
own hypothesis*. The mechanism rows survive on their own margins
(`overrunRate` +0.2176 against a ±0.0024 floor is 90× and needs no help), but
every placement sentence about the 500 ms and 1000 ms rungs is unsupported in
both directions.

**Question two: is the widening the box, or the board?** The batch write-up says
"it is not the box", resting on `null-snake6` reproducing batch 1's `score`
floor to three decimals (±0.0324 vs ±0.032). It does. But once **every** metric
is floored rather than only `score`:

| cell / metric | batch 1 | batch 2 | ratio |
|---|---|---|---|
| `headline-mix-king` / `score` | ±0.0973 | ±0.1605 | ×1.65 |
| `headline-mix-king` / `worstWallMs` | ±7.37 | ±21.75 | ×2.95 |
| **`null-snake6` / `worstWallMs`** | **±0.59** | **±10.49** | **×17.76** |
| `null-snake6` / `turns`, `decisions` | ±0.837 | ±1.772 | ×2.12 |

**The snake board's timing floor widened seventeenfold.** It is not that
`null-snake6` was unaffected; it is that a board whose games end on the 120-turn
cap rather than on the clock is insensitive *in the placement column* to a
timing perturbation that is plainly present *in the timing column*. Load average
was 21–24 of 24 cores. So the widening corroborates the open `Cell-Quality` item
**less** than the write-up claims and run conditions **more**, and the two are
separable by the same experiment: run the A/A alone on an otherwise idle box.

**Also owed here.** Six counters had **no usable floor at all** in batch 2
because the A/A itself excluded zero on them — including
`snake5-queen`/`ceilingDecided`, where the A/A reads **−3,407.67
[−6,024.21, −791.13]** and P9 quotes **−2,852.02** on the same counter as a
headline mechanism separation. *The two identical builds moved that counter more
than the treatment did.*

**Arm shape.** N0 alone, idle box, all five boards plus the three budget rungs
as separately-named cells, 16 blocks each.

**Expected games.** 8 cells × 16 blocks × 3 rotations × 2 arms ≈ **768**, or
**~576** if the three already-floored 2000 ms boards are dropped.

**Why it ranks above every treatment.** Batch 2 spent 2,472 games and its
readable-test audit says only **26 of 79** intervals that exclude zero clear
their own floor. A batch cannot be read better than its null, and this batch's
null is the cheapest thing in the queue to improve.
