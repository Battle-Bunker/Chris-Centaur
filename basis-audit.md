# BASIS AUDIT — a clock bug in my own instrument, and what survives it

Cycle 5. This document exists because I found an instrument artifact in my own mining, of
exactly the kind this program keeps having to correct in others. Correcting it makes my
headline numbers **worse**, confirms one finding, and leaves one open structure.

---

## 1. THE BUG: I MIXED TWO CLOCKS

Replay turn records carry two weight sources:

- `board.snakes[].length` — per-unit occupancy, the state the bots **see when deciding** turn `t`
- `standings[].material` — per-team weight, **after** turn `t` resolves

They are one turn apart. Verified directly: `standings[t] == board[t+1]`
(turn 3 standings red = 19 → turn 4 board red = 19; turn 5 standings green = 12 → turn 6 board
green = 12).

**My cycle-3 and cycle-4 mining read `W` and `p` off `standings` while reading gains and losses
off `board` lengths.** Every fold term therefore combined a pre-resolution weight change with a
post-resolution share state.

**How it was caught:** the attribution audit I built to answer the epistemics red team reported
54–88% of weight movement as "unattributed" — an absurd number for a conserved quantity — and the
per-turn gaps alternated exactly +1, −1, +1, −1 on consecutive turns for the same team. That is
an off-by-one signature, not a missing channel.

**On one clock (the board), the attribution gap is 0.00%.** Per-unit flow events account for
100% of weight movement, exactly. So the three-flow decomposition **is** exhaustive at event
level — which is worth stating, because it was never actually in doubt and my broken instrument
briefly suggested otherwise.

---

## 2. CORRECTED NUMBERS — they are worse than what I reported

All on the board clock, `events[t]` resolving `board[t] → board[t+1]`, 144 games:

| basis | fitted k | R² | **R² at k ≡ 1 (zero fit)** | corr(resid, severs) |
|---|---|---|---|---|
| A — deaths only (cycle 3) | 1.276 | 0.9346 | 0.8908 | **−0.409** |
| **B — deaths + severs (cycle 4)** | **1.230** | **0.9431** | **0.9101** | **+0.063** |

Against what I previously reported on mixed clocks (k=1.185, R² 0.9746 / 0.9507): **the corrected
zero-fit R² is 0.9101, not 0.9507.** Those earlier figures are withdrawn.

---

## 3. WHAT SURVIVES, AND IT SURVIVES MORE CLEANLY THAN I CLAIMED

**The sever finding stands, and the corrected version is stronger.** The epistemics lens
predicted that a mis-carved basis would leave residual loading on the event class it mishandles.
On a correct clock:

- basis A (deaths only): `corr(residual, severed cells) = −0.409`
- basis B (deaths + severs): `corr(residual, severed cells) = +0.063`

**Adding the sever channel takes that axis from strongly loaded to essentially white.** My
contaminated version reported +0.239; the true figure is +0.063. The defect was real — outflow
counted only whole-account wipes, while the corpus says severs move three times the kill
channel's material — and fixing it does what a correct fix should do.

So: their diagnostic worked, it identified a real omission, and the omission is now closed on
that axis.

---

## 4. THE ONE STRUCTURE THAT IS STILL THERE, AND IT IS THE LARGEST

`corr(residual, game length) = −0.546` on basis B — **bigger than the sever loading ever was**,
and adding severs made it slightly worse (A: −0.494 → B: −0.546). Two candidate explanations,
both tested, **neither sufficient**:

**(a) Compounding — weight preserved early is worth more than weight preserved late, and a
constant `k` cannot say so.** Tested with a horizon weight `(turnCap − t)/turnCap`, known at
decision time so there is no leakage:

| horizon weighting | k | R² | R² at k=1 | corr(resid, turns) |
|---|---|---|---|---|
| none (constant k) | 1.230 | **0.9431** | **0.9101** | −0.546 |
| `1 + √remaining` | 0.729 | 0.9251 | 0.7976 | −0.429 |
| `1 + remaining` | 0.808 | 0.9129 | 0.8611 | −0.395 |

It moves the loading in the right direction and **costs more fit than it buys**. Directionally
right, functionally wrong.

**(b) The elimination discontinuity — a linear flow fold structurally cannot express a step.**
Partly true and mostly absorbed by length:

```
corr(resid, #teams eliminated)          = +0.358
corr(turns, #teams eliminated)          = −0.503
PARTIAL corr(resid, #elims | turns)     = +0.115     <- mostly explained away by length
PARTIAL corr(resid, turns  | #elims)    = −0.453     <- length SURVIVES the control
mean residual: no elimination −0.046 | ≥1 elimination +0.019
```

**Length carries independent structure that elimination does not explain.**

**(c) The leading candidate I have not been able to test cleanly: accumulated linearization
error.** The fold evaluates `(K/W)(1−p)` at the *start* of each turn, so each turn contributes an
`O(Δ²/W)` error; total error would then scale with the number of turns, producing exactly a
length loading, and it is **not a missing channel** — it is the known first-order limitation
accumulating. Distinguishing (c) from a genuine missing channel needs a per-turn integration of
the exact `ΔΦ` against the linearized one on a single clock, which is the next thing to run.

**Status, stated the way I want it read: the largest residual structure in my basis is unexplained,
I have eliminated two of my three candidates, and the instrument that found it is pointed at my own
proposal and staying there.**

---

## 5. WHAT THIS DOES TO THE MEMBER

Nothing structural, and that is the point of having split it in the first place:

- **`value/fold@1`** (derived, `k ≡ 1`, no provenance debt) — corrected R² **0.9101**. Still the
  member I would seat, and its argument was never the R²: it is the Ng policy-invariance theorem,
  which is unaffected by any of this because it is a statement about the *form* `Φ(s′) − Φ(s)`,
  not about a fit.
- **`value/fold-k@1`** (fitted refinement) — corrected `k = 1.230`, buying 3.3 R² points, and now
  carrying a **fourth** provenance defect alongside single-lineage / single-game-labels /
  regicide-absent: **the corpus it was fitted on was read through a clock-mixed instrument.**
  It should not be seated until refitted, and the refit should be done by someone re-deriving the
  extraction rather than reusing my scripts.

---

## 6. THE GENERAL LESSON, SINCE THIS IS THE THIRD INSTANCE

Three instrument artifacts have now been found in this program's numbers: `horizon == 1` in
125,956/125,956 decisions (a `?? 1` fallback, not a measurement); the corpus potion-rarity figure
(measuring our own blindness, not availability); and now my clock mixing. All three produced
*plausible, quotable numbers* that were then reasoned from.

The cheap defence in all three cases would have been the same: **a conservation check.** Weight
is conserved up to named events; horizon is bounded by a search that must have run; potion
availability is bounded by spawn rate × turns. **Any quantity with a conservation law should have
it asserted in the extraction, not checked later** — my 0.00% attribution gap is that assertion,
and had I written it first the mixed-clock numbers would never have been reported.

I would put that in the ledger as a standing extraction rule rather than as a lesson about my
own carelessness, because it generalises past me.
