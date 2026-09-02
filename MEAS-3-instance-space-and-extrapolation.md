# MEASUREMENT ITEM 2 + C60 — instance-space coverage, and where the fold actually breaks

---

## PART A — WHAT OUR VERDICTS ARE QUANTIFIED OVER (item 2)

43 cells, 18,295 games, featured on configuration properties known before play.

| feature | distinct values | coverage |
|---|---|---|
| **teams** | **2** | 3 teams: 42 cells / 18,282 games. **2 teams: 1 cell, 13 games.** |
| **food rate** | **1** | 0.5 everywhere — never varied |
| **potion rate** | **1** | 0.15 everywhere — never varied |
| board size | 4 | 25: 20c/12,094g · 21: 15c/5,492g · 15: 7c/696g · 11: 1c/13g |
| turnCap | 5 | 120: 20c/12,094g · 80: 12c/5,474g · 60,40,25: thin |
| budgetMs | 10 | 200: 9c/4,362g · 2000: heavy · 150/800/4000: 1 cell each |
| hazard damage | 3 | 0.15: 41 cells · 0.05 and 0.30: 1 cell each |
| **pieces of 6** | **4** | **0: 22c/9,001g · 1: 12c/3,798g · 2: 2c/136g · 4: 7c/5,360g** |

**The three findings that matter for how every verdict should be read:**

1. **Essentially every verdict in this program is a 3-team verdict.** 18,282 of 18,295 games. My
   own 2:1 asymmetry result is *derived* for general K but *measured* only at K=3, and the one
   2-team cell has 13 games.
2. **Food rate and potion rate have never been varied.** Two of the game's primary economic
   parameters are constants in the entire archive, so no verdict is quantified over them at all.
3. **Piece count is sampled at 0, 1, 2, 4 — never 3 or 5**, and the 2-piece column is 136 games.
   The instance space is effectively three clusters (all-snake, one-piece, mix-king) with a
   near-empty bridge.

### The interpolating design POP-3's sign reversal calls for

The cycle flips between snake-only (+0.60) and single-piece (−0.43…−0.55). **Piece fraction is the
direction in instance space along which the arm ordering demonstrably changes**, and it is sampled
at 0, 1, 2(thin), 4. The maximally discriminating cells are the ones that bracket the crossing:

> **rosters at 2, 3 and 5 pieces of 6**, holding piece *kind* fixed (all-queen, say) so that the
> only moving variable is count. 3 and 5 have never been run; 2 has 136 games. That is a
> 3-cell addition to the tournament-fill batch design, and it is the cheapest way to locate a
> crossing point that is currently inferred from two endpoints.

---

## PART B — C60: THE FOLD'S EXTRAPOLATION ERROR IS REAL, LARGE, AND *NOT* A FUNCTION OF DISTANCE

C60's proposed test: bin decisions by distance from the fitting corpus, report fold residual per
bin; growing = extrapolation error, flat = generalises. Run over 520 games / 26 cells, with `k`
refit on the potion-ladder cells only and distance measured in standardised instance-space features
(now including piece *kind*, without which every R1 cell sits at distance 0 and the test is void).

**The test fires:**

    corr(distance, mean |fold residual|)  =  +0.423
    near half  mean|resid| = 0.228        far half  mean|resid| = 1.113     (4.9x)

**But the distance framing is wrong, and would have under-warned exactly where the danger is.**

| split | n cells | mean \|residual\| | distance range |
|---|---|---|---|
| **roster contains a KING** | 7 | **1.946** | 3.34 – 3.69 |
| no king | 19 | **0.201** | 0.00 – 4.11 |

    corr(king present, residual)              = +0.954
    corr(distance, residual)                  = +0.423
    corr(distance, residual | no-king cells)  = -0.562        <-- NEGATIVE

**The six farthest cells in the whole set (distance 4.11 — farther than every king cell) have the
LOWEST residuals of all (mean 0.142).** Distance does not predict the fold's error; once the
mechanism is controlled, the correlation reverses.

### What is actually happening, and it is a defect I named and could not test

The fold prices a death at **the dying unit's own balance**. A **last king's death removes the whole
team's weight** — regicide. The fold is structurally blind to that, so on king boards it is wrong by
about an order of magnitude.

This is the **wipe-closure defect** from cycle 4, where I wrote that no fitted cell contained a king,
so *"regicide is outside the corpus, not merely mispriced"*. **Now measured: 9.7× residual.** It is
also the strongest possible vindication of the epistemics lens's premise-coordinate refusal —
`value/fold-k@1` must refuse regicide boards, and the cost of not refusing is a factor of ten.

### The design correction this forces on M77

M77 proposes `advisoryPrecision` gain a producer from **coverage distance from the fitting
distribution** — CQL's pessimism in our vocabulary. **My measurement says distance is the wrong
producer.** Here it would have issued a mild, smoothly-growing warning (+0.42) across a set where
the real structure is a **9.7× step on one binary feature**, and it would have warned *hardest*
about the six cells where the fold is most accurate.

> **Coverage must be declared over MECHANISMS — structural features that change the accounting
> identity — not over a distance metric in feature space. A distance metric averages a step into a
> slope, and under-warns precisely where the identity breaks.**

The mechanism list for the fold is short and enumerable from the rules, which is why this is
tractable: regicide (a death whose closure is the team), mutual annihilation (settlement on the
previous turn), promotion (a weight reset), and the turn-cap adjudication. Each is a **premise
coordinate with a yes/no answer**, not a distance. `advisoryPrecision`'s producer should be
"does this board admit a mechanism my identity does not model", and its consumer — low-precision
advice stakes less of the banked advantage — is right as specified.

---

## PART C — M76, AND AN INTEGRITY NOTE ON ITS TIMING

M76 asks me to pre-register the reading that **extrapolation error predicts the fold should
retrodict outcomes well (in-distribution R²) while ordering counterfactual plans less well (the
out-of-distribution query)** — so a mediocre alignment meter beside an excellent R² is the
mechanism's signature, not a contradiction.

**I cannot register it, because my meter had already run and been published** (`16d7952`,
`MEAS-2-alignment-results.md`) before M76 arrived. Recording that plainly rather than
back-dating it:

- **From the librarian's side it is a genuine prediction** — it was derived from offline-RL theory
  without my numbers, and it is exactly right about them.
- **From my side it is post-hoc**, and I will not present it as anything else.

**And it does fit.** Aggregate order agreement 0.507 against R² ≈ 0.95 in-distribution: excellent
accounting, mediocre counterfactual ordering. **Part B strengthens the reading**: the fold's error
is concentrated where a *mechanism* is missing rather than spread smoothly, which is what an
identity-with-a-structural-hole looks like, and not what generic estimator noise looks like.

The scope split C60 draws is the one I would keep: **the accounting half is near-identity and safe;
the flow ESTIMATORS are ordinary predictors evaluated on unplayed plans, and an argmax comparator
selects for the most-overestimated among them.** Nothing in my lens has measured the estimators'
error on unplayed plans, because replays contain only played ones — that requires the harness to
record scored-but-unplayed candidates, which is the same requirement M72 hit from the other side.
