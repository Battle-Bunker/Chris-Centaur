# What SHAPE the potion member's collector-exposure reading should have

Four attempts have moved every free part of

    peril = Σ_k w_k · beaten_k / |ground_k|   over k = 1..W

— D4 the weights `w_k`, P2 the shape of the share, P3 the set `ground_k`, and
the second attempt the level via `PERIL_WEIGHT` — and all four moved the LEVEL
and left the composition flat (`docs/design/potions.md`). This is the fifth
question asked in the other order: **measure the 35 pickups first, ask what
separates them, and only then name a shape.** No rule is shipped here.

Corpus: `potions`, 60 turns, seeds 1–8, `--nodes`, at `2034f82` — reproduced on
this branch to the digit before anything was read.

| pickups | profitable | reckless | profitable AND safe | arrivalBeaten | deathsWhileDebuffed | deaths |
|---|---|---|---|---|---|---|
| 35 | 15 (42.9%) | 25 (71.4%) | 7 (20.0%) | 5 | **0** | 21 |

## 1. The instrument, and what it added

A temporary, env-gated dump (`POTION_TABLE=1`) in `readPickup`
(`src/tests/local-game.ts`), reverted before this commit — the branch is a
doc-only diff, and all eight `--json` run summaries were byte-identical to the
baseline with it in, so it counted and could not reach what it counted. Per
pickup it recorded, beside the shipped fields:

* the collector's tier before and after, its weight, the allies buffed;
* the per-horizon `[beaten, cells]` of its own claim in the SETTLED frame;
* the number of distinct enemies that beat it at each horizon, and the nearest
  beating enemy's Chebyshev distance;
* and — the part that matters — the same reading recomputed in the **fold's own
  frame** (`readFold`): the pre-decision marshalled board, every enemy held, so
  an enemy at horizon k carries k turns of unknown movement. That reproduces
  `perilOf` exactly (seed 4 t36 red-C: `3/9, 34/34, 73/73 → peril = 0.667`, and
  P3's plan-conditioned `0/1, 5/5, 21/21 → 0.500`, both to the digit), plus two
  new per-plan readings: the collector's one-turn claim FROM its arrival cell
  (`exits`) and how many of those cells the ARRIVAL TURN's enemy field beats
  (`eb1`), which is the "escape options after the pickup" the brief names.

Labels, from the runner's own counters:

| | profitable | not profitable |
|---|---|---|
| **not reckless** | **GOOD** 7 | idle-safe 3 |
| **reckless** | prof-exp 8 | **BAD** 17 |

`deathsWhileDebuffed` is 0 on all 35 — the "died while debuffed" column is
empty, and no quantity can be separated by it.

## 2. Which quantity separates — the numbers, before any proposal

AUC and the best single threshold, GOOD (7) against BAD (17), and GOOD against
the other 28. `peril` and `ground1share` are the fold's own; `escShare`, `eb1`,
`exits`, `free` are the per-plan escape readings; Fisher exact, two-tailed.

| quantity | AUC (G v B) | best rule | tp fp fn tn | acc (24) | acc (35) | p |
|---|---|---|---|---|---|---|
| **`peril` (shipped)** | **0.924** | `peril ≤ 0.268` | 6 2 1 15 | **87.5%** | **91.4%** | **0.0001** |
| `ground1share` = `beaten_1/|ground_1|` | 0.912 | `= 0` | 7 3 0 14 | 87.5% | 85.7% | 0.0003 |
| `eb2share` (horizon 2 from the plan) | 0.887 | `≤ 0.222` | 4 1 3 16 | 83.3% | 88.6% | 0.0031 |
| `planPeril` (P3, α = 1) | 0.874 | `≤ 0.115` | 3 0 4 17 | 83.3% | 88.6% | 0.0053 |
| `escShare` = `eb1/exits` (per plan) | 0.853 | `= 0` | 7 5 0 12 | 79.2% | 77.1% | 0.0010 |
| nearest beating enemy | 0.706 | `≥ 7` | 1 0 6 17 | 75.0% | 82.9% | 0.29 |
| collector weight | 0.626 | — | — | 50.0% | 45.7% | 0.39 |
| allies buffed | 0.647 | — | — | 50.0% | 34.3% | 0.56 |
| **free exits** (`exits − eb1`) | **0.571** | — | 0 1 7 16 | 66.7% | 74.3% | 1.00 |
| `exits` | 0.303 | — | — | 62.5% | 71.4% | 1.00 |

Eleven quantities were scanned at every observed threshold, so p = 0.0001 on the
best of them is worth about p = 0.001 after the search; it survives either way.

**The separating quantity is the one already inside the term.** `peril ≤ 0.268`
misclassifies 3 of the 24 GOOD-or-BAD pickups and 3 of all 35. Its whole
discriminating content is horizon 1: `beaten_1 = 0` at the turn-start ground is
true of **7 of 7** GOOD pickups and 5 of the other 28. Horizons 2 and 3 are the
saturated tail D4 named, and dropping them loses nothing.

Three things do NOT separate, and two of them are the ones a per-plan rule wants:
the number of beating enemies, the collector's weight, and — decisively — the
**free-exit count and the escape-set size** (AUC 0.57 and 0.30). The reach of
the enemy rather than its claim cloud (nearest beater) is 0.706, p = 0.29.

### The margin the quantity has to be spent against

For each pickup, the gap in fold units between the collecting cell it played and
the best NON-collecting candidate in its own top 3:

    GOOD gaps  0.40 0.16 0.51 0.45 0.05 0.72 0.37
    BAD  gaps  0.21 0.39 0.45 0.16 0.65 0.08 0.34 0.16 0.38 0.27   (10 of 17)
               9.80 40.81 50.17 60.01 80.67 88.78                  ( 6 of 17)

The member's whole range is `2 · PERIL_WEIGHT · peril / |ours|` ≤ `4/|ours|`,
i.e. **1.33 fold units at `|ours| = 3`**. So:

1. **Six of the seventeen bad pickups are unrefusable by any bounded member.**
   They stand 9.8 to 88.8 fold units clear of every non-collecting candidate,
   because those candidates lose material.
2. **The refusable bad margins (0.08–0.65) sit inside the good margins
   (0.05–0.72).** A LEVEL move that refuses the bad ones refuses the good ones
   too. That is D4's, P2's and P3's shared result — "a level change moves the
   marginal ones by TOTAL score, and total score is not sorted by
   recklessness" — now with both distributions printed.
3. **The audit's own gate was unreachable.** Refuse every one of the 17 bad
   pickups and 18 remain, 8 of them reckless: **44.4%**. D4's pre-registration
   was reckless ≤ 40%, P2's ≤ 50%. No potion member, and no oracle, could have
   passed D4's gate on this corpus. Three arms were scored against a target that
   does not exist.

## 3. The proposed shape — the gate and the escape floor

One rule, one knob `D` at which `D = 0` is today's member exactly, and two
constants that are read off the measurement rather than chosen:

    b1(collector) = beaten_1 / |ground_1|          horizon 1 ONLY, turn-start
                                                   ground, the shipped reading
                                                   with the saturated tail
                                                   DROPPED rather than reweighted

    gate          = min(1, b1 / τ)                 τ = 0.20, §2's threshold

    escape(plan)  = cells of the collector's own one-turn claim FROM its arrival
                    cell that the arrival turn's enemy field does not beat at
                    the debuffed tier

    peril(plan)   = (1 − D)·peril_today + D · min(1, K · gate · 1/(1 + escape))

`K = 5.08` is not free: it is `median(peril_today) / median(gate/(1+escape))`
over these 35 pickups, which is D4's first prescription — *hold the mean cost of
the corpus fixed and let the shape do the work* — done literally. At `D = 1`:

    corpus median peril  0.565 -> 0.565      corpus mean  0.500 -> 0.486
    mean charge, GOOD    0.267 CHEAPER       mean charge, BAD  0.067 dearer
                                             mean charge, idle-safe 0.438 dearer

It is a price CUT on exactly the pickups that separate as good (all 7 go to
`peril = 0`, because all 7 have `b1 = 0`) and a price RISE on the rest. Every
previous arm moved the price of all 35 the same way.

### It prices two collecting plans differently

`potions` seed 6, turn 39 — **D4's own reproduction**. `(5,8)` and `(2,5)` are
BOTH potion cells; `(1,6)` collects nothing. red is down to two units.

    T 39 red-C knight hp91 (3,7)->(5,8)  top3: (5,8)=-403.05 (2,5)=-403.08 (1,6)=-403.39

    b1 = 3/9 = 0.333  ->  gate = 1
    (the fold's own horizons here are 3/9, 35/35, 75/75 — D4's fixture exactly,
     and the two saturated rows are the ones this shape drops)

    plan   exits  beaten  escape  1/(1+escape)  peril'  charge = 4·peril'/2
    (5,8)      9       4       5        0.167   0.847         1.694   played
    (2,5)     10       3       7        0.125   0.635         1.271
    (1,6)      —       —       —            —       0         0       collects nothing

    today:  charge((5,8)) = 4·0.667/2 = 1.334, and it is IDENTICAL at (2,5)
            and 0 at (1,6) — P2's cancellation, measured.

    (2,5) − (5,8):  +0.03 in score, +0.423 in charge  ->  (2,5) wins by 0.39
    (1,6) − (5,8):  −0.34 in score, +0.360 in charge  ->  (1,6) wins by 0.02

Both jobs on one board: it orders two collecting plans (P3 priced them
identically — `0.5` and `0.5`), and it puts the collecting line below the
non-collecting one (P2 could buy only 0.163 of a 0.65 gap).

`potions` seed 4, turn 36 — **P2's reproduction**, `(4,5)` and `(0,7)` both
potion cells at a 0.04 margin, `|ours| = 3`:

    (0,7) played   exits 5   beaten 2   escape 3   peril' 1.000   charge 1.333
    (4,5)          exits 10  beaten 4   escape 6   peril' 0.726   charge 0.968

    swing 0.365 against a margin of 0.04  ->  red-C takes (4,5)

The non-collecting `(1,4)` is 0.65 away and the charge rises by only 0.444, so
the rule re-sorts this board rather than refusing it. That is honest and it is
the limit named in §2: the term has 1.33 fold units and this gap is 0.65 of them.

### Soundness, the contest floor and the ratchet

* The per-plan half is **already proven sound**: it is P3's construction (the
  board whose only change is the collector's settled occupancy) at one further
  turn instead of `k − 1`. P3's arms ran sixteen `CENTAUR_DEBUG_INVERSION=1`
  gates silent and the six-suite gate at 120 passing with no ratchet moved.
* `gate` is a clamp of a quantity the term already computes — monotone, no new
  uncertain input, no new `reads` entry, `cliff: false` stays honest because
  `min(1, ·)` is a kink and not a jump.
* `law-sweep.test.ts` pins every class not in its table at **0**, and `potion`
  has no class there. The rule must keep it that way. `contest.lo` is CLOSED and
  pinned at 0 (D1's `settlesOn` repair) and nothing here touches `contest`;
  `totalLo` is 0 and stays 0. The bar the sweep sets is unchanged: lower a number
  AND bring an A/B neutral-or-better per board class.
* `collectorsOf` still gates the whole member, so `mixed`, `snakes`, `sparse` and
  `sparse-lean` stay byte-identical. Cost: `W − 1` claim passes per (collector,
  potion cell) key — the key set P3 already paid for and measured at 3m20 against
  3m15 for the corpus.

### The counter

`reckless` is a boolean on the collector's GROUND at horizon 1 in the SETTLED
frame; the rule reads the turn-start ground and the plan's escape set in the
PRE-DECISION frame. They are still not the same question, and P3 §3 says to fix
that before scoring. So the A/B is pre-registered on the shipped counters
(`recklessPickups`, `profitableSafePickups`) **and** on
`pickupGroundBeaten1Sum / pickupGroundCells1Sum`, which is the same arithmetic
the rule charges; a rule that moves the term's own quantity and not the counter's
is a rule that hit a different question, and the pair says which.

### The prediction, per class, falsifiable

`potions` seeds 1–8, 60 turns, `--nodes`, paired by seed, `D = 1`:

* profitable-and-safe **20.0% → ≥ 25%**. First-order, judging each of the 32
  pickups with a measured margin against the margin it actually stood on: all 7
  GOOD kept, 3 BAD and 1 prof-exp refused, 28 remain → **25.0%**. This is the
  half of the prediction that carries the claim; below 20.0% refutes it;
* reckless **71.4% → ≤ 65%**, and NOT ≤ 40% — §2.3 says that is impossible. Said
  plainly: the same first-order arithmetic gives **71.4%, flat**, because the
  three refused BAD pickups are matched by a refused prof-exp one. Any fall has
  to come from the two board-level re-sorts and from second-order play, so a
  flat reckless share is NOT by itself a refutation here, and it would have been
  under D4's and P2's gates — which is the point of §2.3;
* pickups **28 to 42**. This is the sharpest test: D4's price cut gave 63 and
  P2's `γ = 1/3` gave 24, and the median-preserving calibration exists precisely
  to keep the count still while the composition moves. A count outside that band
  refutes the calibration whatever the shares do;
* `deathsWhileDebuffed` **0**; `potions` deaths **not above 21**; no `edge` deaths;
* **board-level, and the cheapest to check**: seed 6 turn 39 red-C plays `(2,5)`
  or `(1,6)`, not `(5,8)`; seed 4 turn 36 red-C plays `(4,5)`, not `(0,7)`. If
  either board is unchanged the rule did not reach the decision and the rest of
  the A/B is noise;
* `mixed`, `snakes`, `sparse`, `sparse-lean`: **byte-identical**;
* law sweep: **no `potion` class**, `contest.lo` 0, `totalLo` 0.

## 4. If no quantity separates them

A quantity does separate, at p = 0.0001 — but it is not the one the last three
attempts went looking for, and the honest reading of §2 is closer to a null than
to a green light. Three facts, plainly:

1. **The separating quantity is a per-collector constant.** `b1` is read from the
   cell the collector stands on as the turn opens, so it is identical on every
   plan in which that collector picks a potion up. That is P2's finding and this
   measurement does not repeal it; the rule above only uses `b1` as a GATE and
   gets its gradient from the escape count — and the escape count, measured, has
   AUC 0.571 and does not separate anything. The rule's ordering power and its
   discriminating power come from two different quantities, and only one of them
   is evidenced.
2. **The per-plan readings that exist are weak.** The arrival cell is beaten on
   5 of 35 (P3 measured this and it is unchanged); the escape share captures all
   7 GOOD but with 8 false positives; the free-exit count separates nothing. On
   the 3 pickups where the collector could reach two potions at once, the escape
   SHARE is identical on 2 of them and only the COUNT differs.
3. **Half the bad pickups cannot be refused at any weight**, and the ones that
   can sit inside the good ones' margin band. The reachable ceiling on this
   corpus — refuse every bad pickup, keep every good one — is reckless 44.4% and
   profitable-and-safe 38.9%. Against 71.4% and 20.0% today, the whole prize on
   eight seeds is about 5 pickups.

**The recommendation, if the rule above is not built: leave the member alone.**
It is sound, it is free on three of the four board classes, it costs no lives
(`deathsWhileDebuffed` 0 across 480 turns and 35 pickups), and the corpus is too
small — 7 good pickups, 17 bad, 6 of them unrefusable — to resolve the shift any
repair could produce. A fifth arm on eight seeds would be scored on a difference
of four or five events, which is what killed the power of every arm since the
first. **The cheapest next step is not a member at all: it is twenty seeds, or a
board with more potions and more units** — the third item of the second attempt's
own "what the next attempt should look at", still untried, and the only change
that would make any of these numbers decidable.

### What this section refuses to repeat

Do not re-parameterise `perilOf` a fifth time. The weights, the share's shape,
the ground and the level are all measured. What is NOT measured, and what §3 is,
is a reading that drops the saturated tail instead of reweighting it, gates on
the one horizon that separates, and takes its gradient from a per-plan count
rather than a per-plan share. If that is built, build it with the counter fixed
first and with the seed count raised — otherwise it will be the fourth arm in a
row whose result is "the composition is flat while the count moves".

---

## Status: the fifth arm

**Baseline reproduced.** `potions`, 60 turns, seeds 1–8, `--nodes`, on this
branch before a line changed — identical on every counter to §0's table and to
P2's and P3's:

| pickups | profitable | reckless | profitable AND safe | arrivalBeaten | ground1 | deathsWhileDebuffed | deaths | unit-turns |
|---|---|---|---|---|---|---|---|---|
| 35 | 15 (42.9%) | 25 (**71.4%**) | 7 (**20.0%**) | 5 | 71/316 | 0 | 21 | 3124 |

Both reproductions print at the turn the doc names, to the digit:

    seed 4 T 36 red-C knight hp98 (2,6)->(0,7)
        top3: (4,5)=-342.30 (0,7)=-342.34 (1,4)=-342.99
    seed 6 T 39 red-C knight hp91 (3,7)->(5,8)
        top3: (5,8)=-403.05 (2,5)=-403.08 (1,6)=-403.39

`mixed`, `snakes`, `sparse`, `sparse-lean`, 60 turns seeds 1–3, are the
potion-free control.

## Status: BUILT, MEASURED, REVERTED — and the member is now closed

The rule of §3 was built exactly as stated, at one knob `D` with `D = 0`
recovering today's term to the bit, and measured on the corpus this document
pre-registers. `docs/design/potions.md`, "The fifth attempt", carries the full
record; the summary is:

| arm | pickups | profitable | reckless | profitable AND safe | arrivalBeaten | ground1 share | deathsWhileDebuffed | deaths |
|---|---|---|---|---|---|---|---|---|
| `D = 0` | 35 | 15 | 25 (71.4%) | 7 (20.0%) | 5 | 0.225 | 0 | 21 |
| `D = 1` | **67** | 18 | 51 (**76.1%**) | 9 (**13.4%**) | 12 | 0.203 | **1** | **23** |

Against §3's own predictions: profitable-and-safe ≥ 25% — **no**, 13.4%.
Reckless ≤ 65% — **no**, 76.1%. Pickups 28–42 — **no**, 67, and §3 named that
the sharpest test and the one the `K` calibration existed to pass.
`deathsWhileDebuffed` 0 — **no**, one. Deaths not above 21 — **no**, 23.
Potion-free classes byte-identical — **yes**. Law sweep, the sixteen-arm
inversion gate and the six-suite gate — all clean, no ratchet moved.

**The two board-level predictions HOLD.** Pinned as boundary tests on the two
boards and measured through the member's own peril half, the shape prices
`(5,8)` above `(2,5)` by more than the 0.03 margin, above `(1,6)` by more than
the 0.34 gap, and `(0,7)` above `(4,5)` by more than the 0.04 margin — all three
as §3 predicts. In the live A/B neither board recurs: both games diverge at turn
2, on a collecting candidate priced 0.28 fold units cheaper. §3 said "if either
board is unchanged the rule did not reach the decision and the rest of the A/B
is noise". The rule DID reach the decision, on both boards, and the rest of the
A/B is the worst of the five arms. **Reaching the decision was never the binding
constraint**, and that retires the prescription three previous attempts closed
on.

The mechanism is §4's first fact arriving from the other side. `b1` separates
the pickups the bot TOOK; the rule is applied to the pickups it is OFFERED, and
`K` — calibrated to hold the median charge of the accepted set fixed — cannot
hold a count still while a third of that set is sent to zero, because the
distribution it was fitted to is the output of the decision it changes. Deleting
the saturated tail is the largest price cut of the three arms that moved it, and
it produced the largest pickup rise: 35 → 67, against D4's 39 → 63 and P3's
35 → 49.

**The knob is deleted and the boundary tests with it** — a fixture for a refuted
rule is not taken. `window.ts` and `tier-window.test.ts` are a zero diff against
the working head and all eight `potions` summaries reproduce the baseline
byte-for-byte.

### The recommendation, now unconditional

§4's closing paragraph said "the recommendation, if the rule above is not built:
leave the member alone". The rule was built. **The recommendation stands
unchanged and is now the finding rather than the fallback: leave the potion
member alone until the game changes.** Five shapes have been measured — the
level, the horizon weights, the share, the ground, and a rule that is not a
reparameterisation of any of them — and all five moved the count and left the
composition flat. §2.3 proves the audit's target was unreachable in principle:
six bad pickups are unrefusable at any bounded weight and the reachable ceiling
is reckless 44.4%. Do not open a sixth arm on this corpus. The only step that
makes these numbers decidable is more board — twenty seeds, or a scenario with
more potions and more units — and it has been the recommended next step since
the second attempt.
