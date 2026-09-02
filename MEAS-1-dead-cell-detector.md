# MEASUREMENT ITEM 1 — THE DEAD-CELL DETECTOR

The detector I asked for in M26, specced by the librarian and built here. **One column over the
arm × cell matrix `POP-1` already produces**; no games.

    signal(cell)    = sd across arms of their mean sharePar                 (BETWEEN-arm)
    floor(cell, B)  = the A/A floor at a FIXED SPEND B: the typical gap between two
                      disjoint B-game samples of the SAME arm on that cell
    DEADNESS(B)     = signal / floor(B)          <= 1  =>  DEAD AT THAT SPEND

**Distinct from M5, and that is the point.** M5 asks whether the *outcome* varies; deadness asks
whether it varies **between arms**. A cell can be lively to M5 and dead to arms — every arm scoring
the same on average while individual games swing wildly — and that is **the worst block to buy**,
because M5 reports it as healthy.

---

## 1. A BUG THE POSITIVE CONTROL CAUGHT

My first version computed the floor by halving whatever games the cell happened to have. That floor
shrinks as 1/√n, so **any** non-zero arm difference becomes "live" given enough games — and
`snake5-knight`, independently shown dead three times, scored **6.31, "live"**.

That ratio is a **significance** statistic, not a **decision** statistic. Deadness has to answer
*"if I spend B games per arm here, will the arms separate?"*, so **B is fixed by the experimenter,
not by the corpus.** With the floor evaluated at a standard block size the control behaves.

This is R-8's cousin and I would state it beside it: **never build a spend-decision statistic whose
denominator is the amount already spent.**

---

## 2. THE TABLE (B = 24 games/arm; 38 cells with enough data)

| cell | arms | n/arm | M5 (outcome sd) | signal | floor(24) | **DEADNESS** | verdict |
|---|---|---|---|---|---|---|---|
| potion-hazdose15-snake6 | 3 | 288 | 0.626 | 0.027 | 0.071 | **0.39** | DEAD |
| potion-hazdose05-snake6 | 3 | 276 | 0.629 | 0.035 | 0.073 | **0.48** | DEAD |
| potion-snake5-knight | 6 | 48 | 0.735 | 0.048 | 0.080 | **0.60** | DEAD |
| potion-ladder-snake5-knight | 3 | 96 | 0.582 | 0.055 | 0.065 | **0.84** | DEAD |
| potion-hazdose30-snake6 | 3 | 288 | 0.659 | 0.080 | 0.073 | 1.09 | marginal |
| **snake5-knight** | 3 | 1056 | 0.714 | 0.106 | 0.079 | **1.34** | marginal ← *positive control* |
| snake5-pawn | 4 | 96 | 0.881 | 0.178 | 0.102 | 1.75 | marginal |
| c3-knight | 3 | 48 | 0.595 | 0.296 | 0.059 | 5.00 | live |
| … | | | | | | | |
| null-snake6 | 4 | 96 | 1.003 | 0.930 | 0.026 | 83.0 | live |

**The positive control passes in the right direction.** Every knight-family cell sits at the dead
end: two are outright DEAD, and `snake5-knight` itself is the 6th deadest of 38 at **1.34** —
"you would *barely* see it at 24 games/arm", which is exactly what the R1 ladder experienced when
it spent 8 blocks there and returned G = +0.060 with CIs containing zero.

**And the spec's central claim is confirmed: all four DEAD cells have HIGH outcome variance**
(M5 = 0.58–0.74). They are lively to M5 and dead to arms — precisely the blocks M5 cannot protect
against.

---

## 3. WHAT IT SAYS ABOUT SPEND ALREADY MADE

| spend budget | dead cells | games already spent on them |
|---|---|---|
| B = 24 | 4 of 38 | **~1,350** |
| B = 96 | 4 of 21 | **~2,232** |

Out of ~18,300 archive games. The single worst case is **`potion-hazdose15-snake6`: 288 games per
arm spent on a cell where the arms differ by 0.027 sharePar against a 24-game floor of 0.071** —
deadness 0.39, the deadest cell measured.

**Deadness is budget-dependent and must be quoted with its B**, which is a feature: it converts
"is this cell worth running" into "is this cell worth running *at the spend I have*", and a cell
can be dead at 24 and live at 96.

---

## 4. HOW TO USE IT

- **Run it before committing a block, not after.** Deadness needs only a small pilot on the cell
  (enough for the floor at the intended B) plus any prior arm estimates.
- **A cell that is dead at your budget should not be run at that budget** — either raise B until it
  clears, or drop the cell. The R1 ladder would have been told, before spending, that its knight
  rung was marginal at 8 blocks.
- **Pair it with M5, never substitute.** High M5 + low deadness is the trap; low M5 + low deadness
  is just a quiet cell.
- **It is a property of (cell, arm-set), not of the cell alone.** A cell dead for
  {territory, material, reflex} may be live for arms that differ in what that board rewards. The
  column should be recomputed whenever the arm set changes — which is also `POP-1`'s branch (b).
