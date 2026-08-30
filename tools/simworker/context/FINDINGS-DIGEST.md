# FINDINGS DIGEST — what the program already knows

One page per verdict, with the numbers. This is context for interpreting your
own results, not a set of conclusions to defend. Where your measurement
disagrees with something here, **your measurement is the new evidence** — say
so plainly, quote both, and let the disagreement stand in findings.md.

Everything below was measured at 150 ms or 1000 ms. The owner's program runs at
**2000 ms**, which is off the end of every ladder here. That is the point of it.

---

## 1. The slider deficit is the objective's fault — and it is own-team + reach's

**Verdict: the territory heuristic is wrong about sliders, not starved.**

The budget ladder (132 games, bit-identical boards across budgets) found a
pooled slider deficit of **-0.222 [-0.361, -0.056]** at 1500 ms, with
83-140 plans/decision. Going 500 -> 1500 ms bought nothing. More search does not
fix it, because search was never the problem.

Located exactly, on 1,610 same-board probe samples (one piece swept across its
full legal action set with the joint context fixed — no anytime noise anywhere
in it):

- **The partition cannot see a slider move.** `ours - theirs` range is exactly
  0 across all 71 legal actions of a queen in 87-100% of positions, every piece
  kind. `room` is plane-1-only, so it is identically 0 for a piece *by
  construction*.
- **Weighted spread over one piece's own options:** reach 0.0000-0.0076, room
  0.0000, **healthEconomy 0.2300-0.3700** — 47x to 195x.
- **Inside the material-tie class** (what `est` actually orders): reach's median
  spread is **exactly 0** for rook/knight/king/pawn and **one board cell** for
  the queen, against health 0.030-0.045. The profile's est-argmax is the
  **shortest-travel option among material ties in 73-96% of positions**.
- **Exchange rate:** one cell of travel costs 0.00226-0.00500 weighted; one cell
  of board is 1/529 = 0.00189. The evaluator prices travel at 1.2-2.6 cells of
  territory, and the whole range of the territory term buys 0-3.3 cells of
  travel.

**Root cause, structural:** plane 2 credits a piece where `arrival_p(c) <= D(c)`,
and a slider's arrival is <=2 turns to nearly every cell *from any square*. The
displacement set is saturated, so it carries no gradient in the slider's own
position. **It gets WORSE with board size** — the same feature separates a
queen's options fine on a 9x9 (spread 0.21).

> **Direct consequence for your 25x25 program.** This is the largest board the
> harness supports and the deficit is board-size-monotone. Every slider-bearing
> cell you run is at the worst end of a known degradation. Expect the piece
> rosters to look worse than the 23x23 numbers here, and do not read that as a
> regression in whatever you are testing.

Retires both "tune reach" and "give territory more search" for slider boards.

---

## 2. I2's slider repair: null at 150 ms, erases the deficit at 1000 ms

**Verdict: ship-candidate at a production budget.** 492 games, paired-concurrent
arms, quiet box.

| | 150 ms (16 blk/cell) | 1000 ms (4 blk/cell) |
|---|---|---|
| shipped, slider cells | -0.292 [-0.385, -0.193] | -0.292 [-0.542, -0.063] |
| REPAIRED, slider cells | -0.297 [-0.432, -0.156] | **+0.021 [-0.083, +0.125]** |
| arm contrast, slider | -0.005 [-0.146, +0.135] | **+0.312 [+0.021, +0.625]** |
| arm contrast, no-slider | -0.016 [-0.094, +0.057] | -0.042 [-0.125, 0.000] |
| NULL CELL | -0.021 [-0.104, +0.042] | -0.042 [-0.125, 0.000] |

Snake-only win preserved at both budgets (+0.500 at 1000 ms, 24/24 firsts).

The repair (`command` + a movement-budget term) is gated on class properties, so
a board with no piece on it scores identically to shipped territory. That is
what makes `snake6` a **provably inert null cell** for this arm.

> **This is a BUDGET GRADIENT: null at 150, wins at 1000.** Two points define a
> line and nothing more. **2000 ms is the third point, and P3 is that
> measurement.** The interesting outcomes are all three: it keeps growing, it
> plateaus, or it turns over.

**The profile is merged but nothing in production selects it.** There is no env flag and no config field
that selects it. `TeamDecisionOptions.evaluate` is the only seam, and the
harness holds it (`lobster-slider`). Selecting it is a harness act, not a
deployment act.

---

## 3. gainOrdering: validated, and selected by default

I3's verdict was "promote gainOrdering FIRST — 30 lines, guard-free,
profile-independent, reproduces the WHOLE effect alone". It is now the default
on the integrated branch (`candidates.ts`, `gainOrdering: true`).

Mechanism results **5-25x outside the null band in every arm, cell and budget**:
food landings +4.5/100UT, eats +4.6/game (+9.3 at 1 s), >=3-turn king-exposure
attempts 0.33 -> 0.90, piece stay -0.08..-0.16.

**Placement was NOT claimable at that n** and the verdict said so:
`i3-order` place-1 +0.417 [0.167, 0.667] at 8 blocks = suggestive only, "needs
>=60 blocks with concurrent null". That block count has never been run.

Diagnosis worth carrying: *"the bot was not refusing these moves, it was never
HANDED them"* — candidateCap 8 + stay-first health ordering (meals are free,
health refunds to max, but were charged full price in ordering) + only 3-6
plans/decision.

At 1000 ms the king metrics **stop moving** (the search finds them itself) while
the food metrics keep growing. Another budget gradient your 2000 ms cells sit
past the end of.

Only the ordering was selected by default. I3's evaluator features (weights) were NOT
shipped.

---

## 4. The staging guard sign-flips by board class

**Verdict: ship for PIECE boards as a rule-certainty defect fix; do NOT ship
unconditionally — the snake-only no-regression gate FAILS.**

This is the program's sharpest example of a treatment whose sign depends on
roster, and the reason `x2-roster-ladder` exists.

Piece cells (n=48): score **+0.146 [+0.031, +0.250]**, vs-material
+0.240 [+0.031, +0.438], material +3.000 [+0.313, +5.583], allDeaths
-0.958 [-1.646, -0.250] — all clear of their own nulls.
Pooled across all cells (n=60): **NULL** (+0.017 [-0.142, +0.158]).
Self-inflicted deaths/game 2.05 -> 0.00 pooled, -2.050 [-2.533, -1.633] against a
null of 0.000 [-0.317, +0.300].

**The gate failure, and it is the interesting half:** snake-only score
**1.000 -> 0.500**, -0.500 [-0.708, -0.333] against a null of -0.083
[-0.250, 0.000].

Mechanism, traced twice: (a) refusing only the mover's own body left allDeaths
unchanged — 22 removed deaths came straight back as `bodyBlock` on a *team-mate's*
body; (b) **the degenerate ordering was accidentally collision-free** — every
snake staging `up` is parallel motion, and the guard breaks that coherence
without replacing it. *A per-unit refusal cannot produce team-level coherence.*
Snake-only is where it bites because the board is dense and territory is already
at score 1.000 — there is no headroom up, only down.

Current default on the integrated branch is `CENTAUR_STAGING_SAFETY=auto`, which
resolves to `full` **when the board bears a piece** and off when it does not —
the verdict shipped as the default rather than left to an operator.

---

## 5. The lobster engine default, sustained at 1 s

The default was `legacy` on a measured verdict. The 2026-08-23 gate found
snake-only boards behind — the only shape where legacy speaks for every unit it
owns, so the only rows measuring SEARCH rather than "legacy has no piece bot":

```
snake-only pooled, 32 seeds / 64 matches, 1 s, paired + side-swapped
  pairedScore  -0.59 [-0.97, -0.22]   seed-level W/L/D 3/15/14
```

The re-run of 2026-08-26, same harness, same seeds, same budget, quiet machine
(load 0.3-2.8 per match, recorded per match), with the TERRITORY profile:

```
snake-only pooled, 32 seeds / 64 matches
  pairedScore  +0.81 [+0.44, +1.19]   seed-level W/L/D 19/4/9
  pairedMargin +3.03 [+1.56, +4.53]
  paired per-seed delta vs the 08-23 arm
               +1.41 [+0.91, +1.88]   26 better / 4 worse / 2 equal
  snakes11 n=20  -0.55 -> +0.45 [+0.05, +0.90]   delta +1.00 [+0.35, +1.60]
  snakes13 n=12  -0.67 -> +1.42 [+0.92, +1.83]   delta +2.08 [+1.58, +2.58]
```

Conduct over 2352 team decisions: 0 illegal staged cells, 0 staged-nothing, 0
decisions that threw, 0 unstaged units, 0 deadline overruns (the only overruns in
the run were the legacy arm's: 7, worst 143 ms).

**What it costs, stated:** territory evaluates 45-56% of the plans a
material-only decision would, on snake-only rosters at 1 s, and 49-73% on mixed
ones. Per node, 32-109 us against material's 18-56.

**The one row that is not clean:** `big13` (26 units) n=8, territory
-0.75 [-1.75, +0.50] against material +0.25 [-0.75, +1.25], delta
-1.00 [-2.50, +0.50]. Down on the point estimate by an amount 8 seeds cannot
separate from zero, on the shape where the depth cost is largest and the
territory floor weakest.

> **`big13` is the closest existing shape to the owner's headline cell** —
> 26 units against your 18, and the same "many units, big board, slider-heavy"
> regime. It is the one open question this program never resolved, and P1/P2 at
> 2000 ms are where it gets resolved. Watch it.

---

## 6. What was measured and did NOT survive

Kept because knowing what failed is how you avoid re-running it.

- **I1's 1000 ms arm: RETRACTED.** Its own null reported score
  +0.208 [+0.042, +0.417] and material +4.000 [+2.583, +5.250] on two
  byte-identical arms. The treatment sat inside the null. Three concurrent 1 s
  wall-clock searchers on four cores do not get equal service.
- **`boundsInversions` retired.** Base 86 / null 8075 / mine 1197 on identical
  binaries.
- **I6's placement effects: not claimable**, and retracted by its own null's CI
  widths, despite deterministic mechanism evidence (3,000 replayed positions:
  53/54 fatal holds pruned; hurt-mover fatal offers in top-8 -88%; 2,500/2,500
  hazard-free sets byte-identical). Discipline held.
- **The tier-truth potion-board widening: HELD.** An 858-inversion interaction
  storm (class B0 floor > B1 ceiling). The upstream engine fix it was gated on
  has landed; **the re-measure has not been run.** That is P4 — and note the
  arithmetic changed underneath, so the old inversion counts describe code that
  no longer exists. Measure fresh; do not compare to them.
- **Lookahead never engages.** `chosen.horizon == 1` in ALL 132 games of the
  budget ladder, at every budget. Budget buys breadth, never depth. The
  lookahead machinery is untested capability. **At 2000 ms, check whether this
  is still true** — a horizon that finally moves would be a significant finding
  in itself, and it is free to look at (it is in the replay's chosen-plan
  record).

---

## 7. Open, and pointed at your program

| # | Question | Where it lands |
|---|---|---|
| 1 | Does the perf substrate change STRENGTH, not just speed? | **P1** |
| 2 | Does the lobster default hold at 2000 ms on a 25x25 with 18 units? | **P2**, and it is `big13`'s open row |
| 3 | Does I2's budget gradient keep climbing past 1000 ms? | **P3** |
| 4 | Does the tier-truth widening still storm after the engine fix? | **P4** |
| 5 | Does the WASM arm engage at all at 2000 ms, and does it pay? | **P5** |
| 6 | Does the cohort governor help on crowded boards? | **P6** — blocked, branch unpublished |
| 7 | Do CL1's cluster-seed and unit-fatality survive live play? | **P7** |
| 8 | Does `chosen.horizon` ever exceed 1 at 2000 ms? | free, in every replay |
| 9 | Does gainOrdering's placement effect appear at >=60 blocks? | needs a dedicated long batch |
