# M64 — IS THE CYCLE SELECTABLE? No. And POP-1's null survives a far stronger test.

The librarian's observation is right and it is the sharpest thing said about my two population
instruments: **they interact, and POP-3 is a mechanism by which POP-1's null could be a pooling
artifact.** A cyclic component that flips sign between board families is *by definition* a region
where the best arm depends on the board — the exact quantity VBS−SBS detects, and the exact thing
a pooled average destroys. The test was cheap, sharp, and falsifiable. It returns the second
branch.

---

## 1. DESIGN — why this is not selection on the outcome

The selector is keyed on **board family read off the roster** — `snake-only` versus `has-piece` —
which is a *pre-specified, observable* property of the configuration, fixed before any game is
played. It is not "the cells where switching happened".

And it is **cross-validated**: within each cell the games are split in half, the family-best arm is
chosen on one half and scored on the other, 300 repetitions. So the reported gain is what an
*attainable* selector would actually earn, not an oracle's.

Four quantities under one protocol:

| | what it is |
|---|---|
| **SBS** | one arm everywhere, chosen on the training half |
| **FAMILY** | one arm per board family — the conditional selector, 1 bit of information |
| **ORACLE** | one arm per cell — unattainable; this is POP-1's figure, now cross-validated |
| **FLOOR** | the same procedures over pseudo-arms built from one bot's own games |

---

## 2. THE RESULT

**`{lobster-material, lobster-territory, reflex}` — 26 cells (19 has-piece, 7 snake-only):**

| | score | gain over SBS |
|---|---|---|
| SBS | 1.6214 [1.5769, 1.6723] | — |
| **FAMILY** | 1.6079 [1.5218, 1.6479] | **−0.0134 [−0.1446, +0.0000]** |
| ORACLE (per-cell) | 1.6411 [1.5703, 1.6931] | +0.0197 [−0.0611, +0.0795] |
| FLOOR | — | +0.0015 [−0.0303, +0.0473] |

**The family-conditional selector loses to a single arm.** Not "gains nothing" — it is *worse*,
with a CI whose upper bound is exactly 0.

**`{parentDefault, potionIntel, reflex}`** — only 4 cells survive the minimum, gains −0.019 and
−0.030 with CIs spanning ±0.2. **Underpowered; no reading taken.**

**Robustness — a finer split is worse, not better.** Three roster families
(snake-only / single-piece / mixed-king) give **−0.0248 [−0.1334, +0.0000]**. Conditioning harder
overfits harder. The null holds at both granularities.

---

## 3. THE READING

> **The cycle is real but too small to select on.** POP-3's intransitivity is significant
> (p = 0.000 at n = 4,841) and does flip sign by board family — but **the magnitude of the
> arm-ordering change it implies is smaller than the estimation noise of choosing a per-family arm
> from finite data.** A selector that must *learn* which arm suits which family pays more in
> estimation error than the conditional structure is worth.

That is a stronger result than the pooled figure, exactly as predicted: **POP-1's "hygiene, not
strength" reading survives a test aimed squarely at the mechanism that could have overturned it.**
It is no longer "we averaged and saw nothing" — it is "we conditioned on the pre-specified variable
the cycle identifies, cross-validated it, and the conditional selector lost."

**And the honest way to state what remains open:** the oracle gain (+0.020) is not distinguishable
from its floor (+0.0015), so even *perfect* per-cell knowledge buys nothing measurable here. The
door M64 leaves open is not "a better selector" but "different members" — which is POP-1's
disjunction branch (b), and which nothing on disk can test.

### A self-correction this forces on POP-1

**My published per-cell gap of +0.071 was in-sample** — the best arm was chosen and scored on the
same games. Cross-validated, the same quantity is **+0.0197**. Cross-validation cuts the apparent
per-cell headroom by a factor of 3.6, and the corrected figure sits inside its own floor's CI.
POP-1's number should be read as +0.020, not +0.071, and I have marked it there.

---

## 4. R-8, MINTED FROM MY OWN THREE CATCHES — AND APPLIED TO MY OWN HEADLINE

The standing rule, as the librarian states it:

> **R-8. Never test for a residual in a bounded statistic. Transform to the scale where the null is
> additive first.**

My three catches this session were all instances: the flood-fill `room` proxy saturating at its
60-cell cap (reported 93–100% zero spread, which was the cap); raw win probabilities saturating
near 0/1 and manufacturing a cycle in a *transitive* triple; and the cyclicity fit itself, where the
scalar-difference matrix has zero curl by construction. The logit is the additive scale in the
ratings case.

**And the librarian is right that the hazard is live beyond ratings: `sharePar` is itself a bounded
share, ∈ [0, K], and my entire fold validation is a residual test on it.** In snake6, territory
reaches the 3.0 ceiling in 19% of games and material/reflex hit the 0 floor in 31–42%. So I applied
R-8 to my own headline:

| subset | n | k | R² |
|---|---|---|---|
| all games | 192 | 1.228 | 0.9462 |
| **no team at a bound** | 82 | **1.108** | **0.9655** |
| some team at a bound | 110 | 1.272 | 0.9452 |

**The fold is not a bound artifact — it fits *better* off the bounds** (R² 0.9655 vs 0.9452), and
`k` moves *closer to 1* (1.108 vs 1.272). So the bound-hitting games were inflating `k` above the
identity, and the clean-subset figure is the one to quote: **k ≈ 1.11 on unbounded games.** The
result survives R-8 and is slightly strengthened by it.

I would still record the caveat R-8 implies for future work: a residual test on `sharePar` is a
test on a bounded scale, and the fully correct version fits on a share-logit. I have not done that,
and the bound-split above is the cheap substitute rather than the fix.

---

## 5. M65 (mElo2k at k=1) — its value changed with this result

M65 was motivated three ways: roster construction spanning the cyclic axis, a deeper redundancy
test (same rating *and* same loading), and **the conditional selector's natural regressor**.

**M64 removes the third motivation** — there is no conditional selector to regress, because the
conditional selector loses. The first two survive, and the redundancy use is the stronger of them:
two arms with the same rating *and* the same cyclic loading are duplicates in a sense that the
rating alone cannot show, which is a sharper version of the +0.996 profile correlation already in
POP-2.

So I would **keep M65, demote it below the members question**, and note that its payoff is now
diagnostic (how redundant is the pool) rather than constructive (how to select). Given POP-1's
branch (b), the members question is the one that pays.
