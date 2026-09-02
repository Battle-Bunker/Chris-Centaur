> **NUMBERS CORRECTED BY `basis-audit.md` (cycle 5).** My mining mixed two clocks
> (`standings[t] == board[t+1]`), so every fold term combined a pre-resolution weight change
> with a post-resolution share state. On one clock the attribution gap is 0.00% and the
> corrected figures are **basis B: k=1.230, R² 0.9431 fitted, 0.9101 at zero fit** — worse
> than reported here. The SEVER FINDING SURVIVES AND IMPROVES: corr(residual, severs) goes
> −0.409 → **+0.063** when the sever channel is added. Largest remaining structure is game
> length (−0.546; partial −0.453 controlling eliminations), still unexplained.

> **SUPERSEDED IN PART (see `reply-to-epistemics-redteam.md`, `value-joint-and-prior-art.md`).**
> The k→1 march is withdrawn as basis evidence — any exhaustive carving produces it. The
> residual-structure test the epistemics lens prescribed was run and **killed this document's
> basis**: residual loaded on severs at −0.537, because outflow counted deaths but not severs.
> Re-carved (v2: deaths + severs) gives k=1.185, R² 0.9746 fitted / **0.9507 at zero fit**, with
> sever loading down to +0.239 and still not white. Also: "a death costs exactly the balance it
> wipes" is FALSE for last kings (regicide wipes the team) — replaced by `w_closure(event)`.
> No fitted cell contained a king. Read this document as the first pass it was.

# VALUE LENS — FINAL SYNTHESIS

Branch `design/value-evaluation`. Companion: `value-algebra.md` (the full argument);
`tools/` (the mining scripts, so every number here is reproducible from replays on disk).

---

## THE ONE-SENTENCE ANSWER TO THE MANDATE

**There is one algebra, and it is not a weighted sum of positional terms: value is
`E[terminal weight share]`, weight is held in per-unit accounts, a death wipes a whole
account, and every heuristic is an estimator of a flow into or out of one — folded by a
coefficient `(K/W)(1−p)·w_u` that the live board supplies and that the shipped evaluator
does not compute at all.**

The evidence is not an argument from elegance. A **single-parameter** version of that fold
reproduces the evaluator ladder's effect sizes across three rosters spanning 27× — **R²
0.949, worst residual 0.027 sharePar** — where counting deaths gives 0.677 and counting raw
weight gives 0.638. All three channels fold with the *same* coefficient, and **that
coefficient walks monotonically to ≈1 as the basis completes — 2.92 → 2.07 → 1.23** — which
is the strongest internal evidence that the three flows are the right three.

---

## 1. WHAT I FOUND, IN ORDER OF HOW MUCH IT SHOULD CHANGE

### 1.1 The fold is real and measured (`value-algebra.md` §3.2)

Pooled through-origin regression, 144 games, three rosters, **one coefficient, no per-cell
tuning**, predicting paired within-game `sharePar(territory − material)`:

| predictor | k | R² | worst per-cell residual |
|---|---|---|---|
| deaths avoided | 0.523 | 0.677 | 0.395 |
| weight saved | 0.128 | 0.638 | 0.315 |
| **Σ (K/W)(1−p)·w_u at the moment of death (outflow)** | **2.919** | **0.866** | **0.085** |
| **+ folded INFLOW, summed as one predictor** | **2.072** | **0.949** | **0.027** |
| **+ folded TRANSFER (enemy losses, at `p`) — all three channels** | **1.227** | **0.970** | **0.035** |

Observed vs outflow-only model: snake6 +1.620/+1.705, queen +0.536/+0.472, knight
+0.060/+0.056. Adding inflow (a unit whose length rises has eaten, folded the same way)
lifts R² to **0.949** with worst residual **0.027**: the two channels are not two terms
needing two weights, they are one net weight-share flow priced by one coefficient. And k
falls 2.92 → 2.07 exactly as the decomposition predicts — the outflow-only coefficient was
implicitly absorbing the future growth a preserved unit goes on to do, and counting that
growth explicitly removes it from the premium. A decomposition carving at the wrong joint
would not do that.

Read correctly: the net-flow predictor is *partly definitional* (`sharePar` is `K·w/W`, and
terminal weight is initial + gains − losses). That is the point rather than a caveat — the
claim is not that a surprising predictor was found, but that **the score decomposes exactly
into share-folded per-unit flows**, so an evaluator estimating those flows estimates the
score with no lossy proxy in between. R² = 0.949 measures the **completeness of the basis**.
What stays genuinely empirical is which flows dominate on which roster, and the value of k.

Each refinement is exactly one term of the share derivative, and each buys accuracy. The
practical consequence is small to state and large to act on: **`room: 3` is wrong by a
factor the engine can compute for free**, and with all three channels folded `k ≈ 1.23` — a fold
that is nearly a pure accounting identity, leaving only a ~20% compounding premium as the
one honest free parameter.

**The architectural payoff, with a number on it.** The shipped evaluator carries six hand-set
coefficients plus a twelve-slot hand-written precedence order, none derived, plus a hand-set
cliff inequality to stop them outbidding each other. The algebra replaces all of it with
**three flows, coefficients computed live from `(K, W, p, w_u)`, and one fitted constant
≈ 1.2.**

### 1.2 The R1 ladder's piece verdict does not mean what it says (§1, §2)

- Territory's **behavioural** edge over material is statistically identical on the queen and
  knight boards (total deaths T−M: −0.271 [−0.61,+0.07] vs −0.167 [−0.62,+0.29]). It is
  equally degraded by both pieces. Only the score conversion differs, 9×.
- **The knight cell is a dead instrument.** `moveGrammar.ts:27` — *"a jump crosses no edge,
  so a knight can never contest one"* — makes the knight unblockable and effectively
  immortal (1 death per 48 games for territory). Team elimination requires all six units
  dead, so it becomes impossible: 48/48 games hit the cap, 0 end by elimination,
  `elim(T−M)` is exactly 0.000 [−0.058,+0.058], all three contenders within 0.14 of par.
  **No evaluator could have scored positive there.**
- **The queen board is one binary variable.** The queen holds 80–91% of team weight;
  `sharePar` given queen-alive is 1.881 vs 0.362 dead (territory). Survival rates of 96% vs
  84% reconstruct +0.47 against the measured +0.536 — **~88% of the effect**.
- **And the ladder seats the wrong profile on piece boards.** `DEFAULT_WEIGHTS.command = 0`
  is what `lobster-territory` uses, and `cells.js:184` seats it everywhere; pieces are
  excluded from plane 1 by construction and `room` is per-trail-unit, so with `command: 0`
  **no territory feature gives a piece any signal at all.** `lobster-territory-x`
  (`command: 2`) ships and was never seated.

### 1.3 Every `(ours − theirs)` balance is calibrated for a two-team game (§3.4)

`∂S/∂w_ours = (K/W)(1−p)` and `∂S/∂w_theirs = −(K/W)p` coincide only at p = 0.5 — a
two-team game at parity. The owner's default is three teams, where the rate is 1:2. Both
headline balances are symmetric differences (`territory.ts:648`, `potion-control.ts:281`).

Confirmed on the replays — regressing each team's `sharePar` on its own weight lost vs the
other two teams' weight lost, 144 team-observations per cell:

| cell | b(own lost) | b(others' lost) | ratio |
|---|---|---|---|
| snake6 | −0.0806 | **+0.0403** | 2.00 |
| snake5-queen | −0.0946 | **+0.0473** | 2.00 |
| snake5-knight | −0.1091 | **+0.0546** | 2.00 |

The sign on third-party losses is **positive everywhere**, and the ratio is exactly 2.00.
The exactness is the regression recovering an identity (`sharePar` *is* `K·w/W`), which
makes a symmetric-difference evaluator **definitionally wrong, not mis-tuned** — no sweep
can repair it. Two specific consequences: at par an enemy-controlled potion is worth **twice**
one we control (counted 1:1), and `potion-control.ts`'s header caveat about third-party
damage is **signed backwards** (it raises our score; `theirsAgainstUs` is the correctly
scoped half and is not the headline).

`(K, W, p)` is one pass over `roster()` from data the substrate already holds. `grep` finds
**no team count and no share computation anywhere in the evaluator collection.**

### 1.4 Where the caps actually bind (§4.7)

`candidateCap: 8` is not one cap, and on the units it is usually discussed about it never
fires. `cluster-enum.ts`'s own census: *"98.9% of team-turns have every non-slider component
at ≤3"*, and `topCandidates` only slices when `cap < length`.

| unit | options | cap | binds? |
|---|---|---|---|
| snake | ≤3 (98.9%) | `enumCandidateCap: 8` | essentially never |
| slider | tens (~71 for a queen) | **`sliderCandidateCap: 4`** | always — ~94% discarded |
| joint | product | `maxJointsPerCluster: 512` | binds at 3⁶ = 729 |

**The two defects converge on one unit.** The queen is simultaneously the unit whose safety
flat `room: 3` under-prices ~15×, the unit whose options are cut 94% by a comparator in
which *nothing scales with weight* (`captureRank` is yes/maybe/no → 2/1/0; `foodGain` is
0/1), and the unit holding 80–91% of its team's score. One blind spot —
balance-insensitivity — expressed once per channel, landing on the unit that decides the
game.

---

## 2. WHAT THE ALGEBRA IS

```
Contribution { unit, flow: 'in'|'out'|'transfer', side, rate: interval, horizon }

ΔS = (K/W) · Σ  sign · shareFactor(side) · rate · horizon · balanceFactor
     shareFactor(ours) = (1−p) ;  shareFactor(theirs) = p
     balanceFactor     = w_u^γ  on outflows ;  1 otherwise
```

| family | emits |
|---|---|
| `material` | the balances themselves — the state, not a rate |
| `reach` / voronoi | inflow: contested food arrival |
| `room`, `healthEconomy` | outflow: box-in and exhaustion hazard × `w_u^γ` — **missing the `w_u` factor today** |
| slider attack vectors | transfer, theirs→nothing — natively in weight, no conversion |
| defence lines / shadowing | outflow reduction, ours — also needs `w_u` |
| potion tier | **not a term** — a multiplier on `P(win)` inside every transfer |

Only γ and the per-flow efficiencies stay free, and the efficiencies are fittable from the
archive with no new games.

**Why potions nulled, and where they wouldn't.** A potion is worth
`Σ_v [P(win|tier+1) − P(win|tier 0)]·w_v`, identically zero when no fat enemy account is
reachable — which is exactly the boards k5 ran on (§2 measured no account there exceeds ~3).
So the null is correct *for those boards* and says nothing about `w_v ≈ 30`.

---

## 3. ANSWERS TO THE OTHER LENSES

**To composition, on the combination law.** Additive over a weight-flow currency — but *the
currency is the deliverable, not the law*; choosing "additive" without commensurable
emissions just restores arbitrary weights. **I withdraw** my stronger claim that one dial
interpolates lexicographic↔additive: γ is a risk-concentration exponent on outflows, and the
lexicographic limit exists only at an unbounded balance ratio, of which this game supplies
exactly one — the account wipe.

**Deriving the twelve slots.** Nine of eleven are value flows the currency subsumes. The
survivors are not value:

| slot | disposition |
|---|---|
| `tier` (`safe`/`atRisk`/`doomed`) | **lattice bottom** — a doomed move is outside the value function's domain, not a low number. Encoding it as a large negative is exactly what would let a dial buy a suicide. Stays precedence; must never become a weight. |
| `contingencies` | **ECONOMY (value of information)** — conceded to the composition lens against my first draft. A quantity meaning "this estimate is soft" is an input to *spending*; putting it in a preference order silently converts uncertainty into distaste. |
| `candidate.to` | determinism |

That leaves precedence with **two** residents, both type-level. Clean boundary: the currency
governs everything denominated in weight; precedence governs what cannot take a coefficient
without a category error.

**On the potion identification — confirmed for two facts, refuted for the third.**

| verdict | admission artifact? | remedy |
|---|---|---|
| "4× potion weights do nothing" | **yes** | withdraw as untested |
| "potionOrdering wins +55% pickups, free" | **yes — same fact** | keep, but state it as a *support* change, not a value finding |
| "potions never pay at any `effectTurns`" (k5) | **no — measured with `potionOrdering` already ON** | re-test on a fat-account board; do not generalise from thin-account boards |

**On the inert-weight taxonomy — accepting two refinements and adding a third.** Accepted:
measure spread **at the point of comparison** (the plans `better()` adjudicates), and **by
unit class**. Added, because the reported data fits neither cause: **"flat-to-worse" is not
the signature of an inert term** — a term with no admission and no gradient is flat at
*every* multiple. Eventually-worse requires non-zero spread. That is **(c) scale
separation**: the term's spread is so small against `material: 10` that it needs a large
multiplier to bite, and by then it has crossed the trade-safety inequality and trades units
for ground. No window helps. This makes the weight-response **curve shape** a diagnostic,
computable from sweeps already run.

**And (c) is dissolved by the currency, not merely diagnosed.** The cliff inequality exists
*only because* ordering terms are in cells and material is in weight × 10 — incommensurable
units needing a hand-set guard. Denominate safety in weight-share and **there is no cliff to
cross**, because a death costs exactly the balance it wipes, which is what material would
have charged. The inequality was a unit-conversion guard, not a strategy convention.

---

## 4. WHAT TO BUILD, AND WHAT TO MEASURE FIRST

| # | action | cost | why first |
|---|---|---|---|
| **M1** | Form `(K, W, p)` once per turn and use it. Replace both symmetric balances with the asymmetric fold. | one pass over `roster()` | §3.4 shows the current form is *definitionally* wrong on three-team boards |
| **M2** | Point-of-comparison feature spread, by unit class, as a standing mechanism-report column | one counter, **no games** | separates the three causes of an inert weight; may reframe the entire additive-channel record |
| **M3** | Re-seat `lobster-territory-x` on the piece cells | two cells | the piece verdict currently measures a profile with its piece term off |
| **M4** | Weight-scale the safety terms: `(K/W)(1−p)·w_u·k` | small | the validated fold, applied |
| **M5** | Rank cells by measured `sharePar` SD before spending blocks | free | 0.898 / 0.998 / 0.582 — the knight cell was never going to resolve anything |

---

## 5. PRE-REGISTERED, BEFORE THE ROOK CELL COMPLETES

Recorded at 12 of 48 games, on the **final three-channel model** with `k = 1.227` **fixed by
the other three cells**. Nothing is fitted to the rook.

| quantity | prediction | reading at n=12 |
|---|---|---|
| rook final weight | between queen (31.2) and knight (3.0), **nearer the queen** | **24.8** ✓ |
| eliminations/game | far above the knight cell's 0.12 — a **live** instrument | **0.75** ✓ (snake6 0.73) |
| **G = territory − material** | **+0.078** = 1.227 × the cell's own net folded flow | +0.060, CI [−1.09,+1.21] — uninformative at n=12 |

The same model on the three cells it was fitted to, for scale: snake6 model +1.655 vs
observed +1.620 (resid −0.035); queen +0.561 vs +0.536 (−0.025); knight +0.058 vs +0.060
(+0.002).

**Be precise about what this tests.** The forecast uses the rook cell's *own* measured flows,
so it tests whether the **coefficient transports** to a roster it was not fitted on — not
whether the flows themselves can be predicted in advance. That is the weaker of the two
things one might want, and it is still a genuine out-of-sample test, because k is fixed
elsewhere and the rook's account structure (a ~25-weight accumulator) is intermediate between
two cells rather than interpolated from them. **If the completed cell's G lands far from
`1.227 × its net folded flow`, the fold is overfitted to three points and I would want that
said plainly rather than explained away.**

Re-run with `tools/forecast-rook3.py` when the cell completes.

## 6. WHAT THIS DOES NOT ESTABLISH

1. **Nothing here is implemented.** Every number is a measurement of existing replays or a
   rule read from the engine.
2. **All three channels are now folded and validated (§3.2b, §3.2c), but at the level of
   the CHANNEL, not of any heuristic.** What is measured is that weight flowing in, out, and
   across prices correctly with one coefficient. What is *not* measured is whether any
   proposed heuristic — attack vectors, defence lines, potion control — estimates its flow
   accurately in advance. The fold tells you what an estimate is worth once you have it; it
   does not supply one.
3. **The pooled regression is driven substantially by snake6**, which carries by far the
   largest signal; per-cell CIs on weight-saved are wide on the other two (queen [−4.2,+0.8],
   knight [−1.7,+1.1]). R² 0.866 against 0.677/0.638 is a real improvement and the residual
   ordering is right on all three — but this is 144 games and three rosters, not a law.
4. **γ has no fitted value.** γ = 1 is proposed as a first probe because it is the
   risk-neutral point, not because it was estimated.
5. **Horizon 1 still binds everything.** `chosen.horizon == 1` in every telemetry record
   across all three cells, 5,000+ decisions per bot per cell. A transfer resolving in three
   turns is invisible to a one-turn search at any weighting.
6. **A cost that cuts against my own case.** The fold's residual is small (worst 0.085). If
   most of the outcome is "keep valuable units alive in share-adjusted terms", then the
   bot-vs-bot headroom for the whole positional portfolio *is that residual*. The Centaur
   argument must therefore rest on **surfacing options a human can act on**, and must not
   borrow the fold's evidence — those are different claims (§6.1).
