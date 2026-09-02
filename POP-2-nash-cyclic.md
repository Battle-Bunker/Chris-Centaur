# POPULATION INSTRUMENT 2 — Nash averaging and the cyclic decomposition

Same population premise as instrument 1: 18,302 archive games, 43 cells, 14 bot identities from
one codebase, no external opponent, conservation asserted in the extraction, `sharePar`
provenance stamped.

**Headline: one half of this instrument returns a real number, and the other half cannot be run
on this archive at all — not because the effect is small, but because the experimental design
makes it identically zero. Establishing that is the result.**

---

## 1. THE TOURNAMENT GRAPH — a real number for the lineage problem

Pairwise antisymmetric payoffs `A[i][j] = mean(sharePar_i − sharePar_j)` over games where both
were seated, edges requiring ≥20 shared games:

```
bots with at least one edge      14
TOURNAMENT GRAPH DENSITY         23 / 91 pairs  =  25%
connected components             1  (via reflex, degree 9 — the hub)
largest complete subgraph        4  [material, slider, territory, reflex]
```

**Three quarters of the bot pairs in this archive have never played each other.** Degrees:
`reflex` 9, `parentDefault`/`plain` 5, everything else 2–3. The archive is not a tournament; it is
a set of nearly disjoint three-seat experiments chained through a common weak opponent.

**This is ruling 49's lineage problem as a measurement, and it has a consequence for every
cross-block claim already on the books.** The transitive rating below places `potionBold` and
`lobster-territory` on one scale, but they have never met: the comparison runs through `reflex`,
*on different boards*. Cross-block ratings are therefore confounded with cell, not merely
noisy. **Within a block the order is sound; across blocks it is an extrapolation through a shared
weak opponent, and should be quoted with that caveat or not at all.**

Weighted HodgeRank transitive ratings (all observed edges): territory +0.563, slider +0.365,
parentDefault +0.211, armA +0.200, armB +0.188, potionIntel +0.125, searchOnly +0.045,
potionOrder +0.027, plain −0.022, potionBoth −0.029, material −0.070, potionAware −0.277,
potionBold −0.318, reflex −1.009.

---

## 2. CYCLICITY IS UNMEASURABLE HERE — BY CONSTRUCTION

The global Hodge split returned a **cyclic fraction of 0.1%**, which reads as "perfectly
transitive, rosters need not be mixtures". **That reading is wrong, and so is its opposite.**

**First check — per triangle rather than globally.** The 25%-dense graph contains only **11
triangles of a possible 364**, and cyclicity can only be observed on a triangle. Per-triangle
relative cycle magnitude:

| triangle | shared games | relative cycle |
|---|---|---|
| material / slider / territory | 192 | **54.9%** |
| slider / territory / reflex | 192 | **46.4%** |
| plain / potionBoth / potionOrder | 934 | **39.9%** |
| material / slider / reflex | 192 | 26.6% |
| … | | |
| **material / territory / reflex** | **4,841** | **0.01%** |
| armA / armB / parentDefault | 228 | 0.00% |

Mean relative cycle magnitude **20.2%**. The global 0.1% was the game-weighted fit being swamped
by one enormous, perfectly transitive triangle. So far this looks like a real and substantial
cyclic component that the global statistic hid.

**Second check — and it dissolves both readings.** Measure the cycle *within games where all
three bots were seated*:

```
material/territory/reflex     n=4841   mean cycle = -0.000000   max|cycle| = 0.000000
plain/potionBoth/potionOrder  n= 934   mean cycle = -0.000000   max|cycle| = 0.000000
parentDefault/potionIntel/reflex n=302 mean cycle = +0.000000   max|cycle| = 0.000000
armA/armB/parentDefault       n= 228   mean cycle = +0.000000   max|cycle| = 0.000000
material/slider/territory     n= 192   mean cycle = -0.000000   max|cycle| = 0.000000
```

> **In a three-seat game the cycle telescopes to exactly zero: (sᵢ−sⱼ) + (sⱼ−sₖ) + (sₖ−sᵢ) ≡ 0.**
> Every triangle, every game, to machine precision.

So an observed cycle can only arise from **comparing edges measured on different game
populations**. Re-testing each triangle on a common cell basis with equal edge counts:

| triangle | common cells | games per edge | cycle |
|---|---|---|---|
| plain / potionBoth / potionOrder | 6 | 934 / 934 / 934 | **+0.000000** |
| material / territory / reflex | 26 | 4841 / 4841 / 4841 | **+0.000000** |
| material / slider / territory | 4 | 192 / 192 / **3138** | +0.2987 |
| slider / territory / reflex | 4 | 192 / **3138** / 192 | +0.5910 |

**The two triangles that showed 55% and 46% cyclicity are exactly the two with grossly unequal
edge bases** — two edges on 192 games and one on 3,138. When the basis is equalised the cycle is
zero to six decimal places.

**Verdict: this archive's within-game three-seat design forces transitivity. Cyclicity is not
small here; it is unmeasurable, and every non-zero value it produces is a comparison-basis
artifact.** To measure intransitivity the program would need *separate* head-to-head matches (two
teams), or three-way play with rotating exclusions, so that A>B, B>C, C>A can occur at all.

**And this degrades the Nash half too.** On a transitive antisymmetric matrix the Nash equilibrium
collapses onto the top arm; the maxent Nash on the 4-clique — slider 0.587, territory 0.413,
**material 0.000, reflex 0.000**, effective support 1.97 of 4, "redundancy 51%" — is measuring a
near-tie at the top under entropy regularisation, **not strategic diversity**. I would not publish
that 51% as the redundancy number ruling 49 asked for. It is an artifact of a degenerate game.

---

## 3. THE REDUNDANCY NUMBER THAT DOES SURVIVE

Redundancy can be measured without cycles: **do two arms respond to boards the same way?** Profile
= per-cell mean `sharePar`, centred within cell. Two arms with correlated profiles are
interchangeable, and their disagreement is precisely what bounds instrument 1's VBS − SBS gap.

**The null matters and it is not zero.** With k seats summing to K in one game, co-seated arms are
pushed toward `corr = −1/(k−1) = −0.5` at k = 3. Read every value against −0.5.

| pair | cells | corr | vs null | reading |
|---|---|---|---|---|
| **lobster-slider / lobster-territory** | 4 | **+0.996** | +1.50 | **REDUNDANT** |
| **plain / potionOrder** | 9 | **+0.879** | +1.38 | **REDUNDANT** |
| parentDefault / potionIntel | 4 | −0.135 | +0.37 | at null — uninformative |
| potionBoth / potionOrder | 6 | −0.265 | +0.24 | at null |
| material / territory | 26 | −0.617 | −0.12 | at null |
| **potionIntel / reflex** | 4 | −0.936 | −0.44 | complementary |

**Two pairs are near-duplicates despite the zero-sum pressure pushing them apart.**
`lobster-slider` and `lobster-territory` correlate **+0.996** across cells — they are, for
selection purposes, one member with two names. `plain` and `potionOrder` at **+0.879** across 9
cells says the potion-ordering flag barely changes how the bot responds to a board — which is the
same fact k5 measured as a null score effect, arriving through a different door.

Everything else sits at the co-seating null: **this archive cannot distinguish complementarity
from the artifact of three arms dividing one pie.**

---

## 4. HOW THE TWO INSTRUMENTS COMBINE

They were commissioned as complementary — redundancy versus complementarity — and they agree:

- Instrument 1: per-board member selection buys **−0.008 against its floor** on the main lineage;
  the only defensible gain is **+0.034**, on hazard boards.
- Instrument 2: **25% of the pairs have ever played**, and among those that have, the two
  best-measured relationships are **near-duplication** (+0.996, +0.879).

> **A small selection headroom over a pool containing duplicates is not evidence that selection is
> worthless. It is evidence that the pool has fewer members than names.** The instruments do not
> license "member selection cannot pay"; they license "member selection has not been *given*
> anything to select between", which is a different problem with a different fix — new members from
> outside the lineage, not a better selector.

**What would move these numbers**, in the order I would try them: (i) genuinely different members
— the Texel lesson, position and opponent diversity from outside one codebase; (ii) a design that
can express intransitivity at all (pairwise matches), without which the Nash machinery has nothing
to compute; (iii) denser tournament coverage — at 25% the archive cannot rank most of its own arms
against each other, and the cheapest fix is scheduling existing arms against each other rather than
each against `reflex`.

---

## 5. WHAT I WOULD NOT CLAIM

1. **Not "the bots are strategically identical".** Two pairs are near-duplicates; most pairs sit at
   the co-seating null, which is uninformative in both directions.
2. **Not "the game is transitive".** The game may well support rock-paper-scissors between
   evaluators; **this archive cannot see it**, and that is a statement about the design.
3. **Not the 51% Nash redundancy figure.** It comes from a degenerate (transitive) game where Nash
   reduces to argmax, and it would be a fabricated precision to publish it.
4. **Not the cross-block transitive ratings as a leaderboard.** At 25% density most pairs are
   related only through `reflex` on different boards.

Bounded statistics were asserted against their bounds in the extraction (cyclicity ∈ [0,1], Nash
mass ∈ [0,1], simplex sum, exploitability ≤ 0.007 confirming the equilibrium solve) — which is how
the cyclicity artifact was caught rather than published.
