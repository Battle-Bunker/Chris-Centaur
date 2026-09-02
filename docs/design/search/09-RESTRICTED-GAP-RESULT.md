# 09 — restrictedGap, measured: the mixed-strategy direction is retired

SEARCH-THEORY lens, document 9. Increment **S0**, built and run rather than
specified. The probe is `probes/restricted-gap.probe.ts`; drop it into
`src/lobster/__tests__/` on `claude/cluster-lookahead` and run it under the
repo's own jest.

**Verdict, in one line: on every board where the bank generates a column at all,
the restricted matrix has an exact pure saddle point, so playing a mixed
strategy over the plans the search considers buys exactly zero — and the
matrices are not degenerate, so that is an informative zero rather than a
vacuous one.**

The mixed-strategy / equilibrium-reading direction (increments R4, S15's
game-theoretic half) is **retired on evidence, with no games played**. Two
other directions the same argument was carrying survive untouched, for reasons
§5 separates.

---

## 1. What was run

| | |
|---|---|
| **columns** | the **real `BoundBank`**. Every row is priced through it and `closeGroup` banks its B1/B3 minimisers exactly as in production. Shipped `DEFAULT_BANK_CONFIG` (`enemyCap: 3`, `gateOnEntanglement: true`, `productCap: 512`) |
| **rows** | the **real cluster enumeration** (`enumerateProposals` at `DEFAULT_CLUSTER_TUNING`), plus the ordered-first seed, plus a *contact seed*, plus the 1-opt neighbourhood of both — which is the set `sweep` walks. Capped at 24 for box courtesy |
| **cells** | **real bounded resolutions**: `sub.resolveBoundedFull(row ⊕ column.replies, asTeam)`, keeping **both** endpoints, so three readings are available from one set of resolves |
| **solver** | regret matching⁺ with linear averaging, alternating updates, 2000 iterations, ~40 lines, no dependency |
| **exact check** | `pureDuality = minMax − maxMin`, computed **without the solver**. It is zero **iff** the matrix has a pure saddle, and it is an exact **upper bound** on `vMixed − vPure` |

**Population premise, stamped on the output and binding on every number below:**
hand-built scenario boards spanning the regimes the program's own cost census
names (quiet trail, slider hub, non-slider big component, contested cells,
duel, corridor), one turn each (turn 22), one seat (`red`), shipped bank config
and cluster tuning, `defaultEvaluator`. **These are not sampled from play.**
Generalising beyond that population is an explicit premise crossing.

## 2. The table

```
board            reading rows cols dead vPure    minMax   pureDual gap    span     rowMinSp #rowMin rowSup colSup
----------------------------------------------------------------------------------------------------------------
quiet-snake6     —       16   0    —    —        —        —        —      —        —        —       —      —      no columns
hub-queen        floor   24   1    0%   11.000   11.000   0        0      7.000    7.000    5/24    4      1
                 mid                    11.000   11.000   0        0      7.000    7.000    5/24    4      1
                 ceil                   11.000   11.000   0        0      7.000    7.000    5/24    4      1
hub-knight       —       12   0    —    —        —        —        —      —        —        —       —      —      no columns
hub-plain        —       12   0    —    —        —        —        —      —        —        —       —      —      no columns
contested-3      floor   17   6    0%   0        0        0        0      9.000    9.000    4/17    4      5
                 mid                    0        0        0        0      6.000    3.000    2/17    10     1
                 ceil                   0        0        0        0      9.000    3.000    2/17    11     1
contested-queen  floor   23   5    0%   1.000    1.000    0        0      4.000    4.000    4/23    10     5
                 mid                    1.000    1.000    0        0      4.000    4.000    4/23    10     5
                 ceil                   1.000    1.000    0        0      4.000    4.000    4/23    10     5
duel-food        —       3    0    —    —        —        —        —      —        —        —       —      —      no columns
duel-bare        —       3    0    —    —        —        —        —      —        —        —       —      —      no columns
corridor         floor   13   5    0%   0        0        0        0      6.000    6.000    3/13    3      4
                 mid                    0        0        0        0      7.500    6.000    3/13    8      1
                 ceil                   0        0        0        0      9.000    6.000    3/13    8      1
```

`span` = max cell − min cell. `rowMinSp` = spread of the per-row minima (the
quantity `better()`'s floor rung actually reads). `#rowMin` = distinct per-row
minima out of rows. All values in **weight units**.

Conservation asserted inside the probe and passing on every row: mixtures are
distributions (sum 1, non-negative); the minimax bracket
`maxMin ≤ vMixed ≤ minMax` holds within a scale-relative tolerance (a real
correctness check on the solver, not a tautology); every cell's floor ≤ its own
ceiling; `minMax ≥ maxMin` exactly. Sentinel sensitivity was checked by moving
the DEAD sentinel four spans out — **stable** on every board, trivially so since
no cell reached DEAD.

## 3. The three findings

### 3.1 `pureDuality = 0` everywhere, at every reading

Exact, solver-independent, and the strongest form the result can take: on
every board that produced a column, `minMax = maxMin`, so the restricted matrix
has a **pure saddle point** and `vMixed = vPure` *exactly*. There is no
approximation and no solver to distrust — the solver's answer merely agrees.

### 3.2 And it is not vacuous — the matrices carry real information

The obvious objection is that a constant matrix has a trivial saddle. It is
ruled out by the spread columns:

- `hub-queen`: **7.0 weight units** of span, **7.0** of row-min spread, 5
  distinct security values across 24 rows;
- `contested-3`: **9.0** span, **9.0** row-min spread, 4 distinct across 17;
- `contested-queen`: **4.0** span, **4.0**, 4 distinct across 23;
- `corridor`: **6.0** span, **6.0**, 3 distinct across 13.

These matrices discriminate between plans by several weight units — the width
of a piece's life — and *still* have a pure saddle. That is the informative
version of the result.

### 3.3 Five of nine boards produce **no columns at all**, and that is a finding

`quiet-snake6`, `hub-knight`, `hub-plain`, `duel-food`, `duel-bare` banked zero
witnesses. The cause is not a harness defect: `gate()` admits only held units
whose claims meet a staged path in sub-step time or that the ledger blamed, and
on a board where nothing contacts, nothing is admitted, B1/B3 never run, and no
minimiser is ever banked.

> **The restricted matrix is empty on a non-contacting board — and correctly so.
> There is no opponent choice that changes our value, so the pure-vs-mixed
> question is not merely answered "zero", it is not posed.**

This bounds where the whole question can live: **the gap can only be nonzero on
contacting boards, and on the contacting boards it is exactly zero.**

## 4. Three claims of mine the measurement corrects

Recording these prominently, because a probe that only confirms its author is
not worth running.

**(a) `rowSupport` is not the discriminator. I said it was, and it is not.**
Cycle 4 stated: *"`rowSupport = 1` on most decisions retires the whole
mixed/equilibrium direction on evidence."* Measured `rowSupport` is **3–11**
with a gap of **exactly zero** — because many rows *tie* at the optimum, and a
tie makes every mixture over the tied rows optimal without any mixture being
*better* than a pure choice. Support size measures degeneracy, not value.
**The correct discriminator is `pureDuality = minMax − maxMin`, which is exact,
solver-free and one pass over the matrix.** Doc 06 §5's emitted-fields list
should lead with it.

**(b) "Microseconds" was wrong by about three orders of magnitude.**
Measured: **50–80 ms** for three readings × 2000 RM⁺ iterations on matrices up
to 24 × 6, i.e. ~20 ms per reading. At the 200 iterations the residual actually
needs it is ~2 ms — still comfortably inside an 18 ms `price()`, and in
production the *cells* are already computed so the solve is the only marginal
cost. But the honest figure is **milliseconds, not microseconds**, and the S0
spec is corrected accordingly.

**(c) §2.3's floor-saturation prediction is UNTESTED here, not confirmed, and
the one signal available points the other way.** I predicted that on contested
cells a saturated floor would carry no ordering information. `deadFrac = 0%` on
every board: **no cell reached `DEAD`**, so the saturation mechanism never
fired and this scenario set does not test it. Worse for the prediction, where
the readings differ at all they differ *against* it — on `contested-3` the
**floor** reading has 4 distinct security values and 9.0 spread while the
**mid** reading has 2 and 3.0, so on that board the floor discriminates *more*
than the midpoint, not less.

The prediction needs a board that forces a mutual kill (both heads onto one cell
at equal weight, no escape), which none of these nine produce. Until such a
board is run, §2.3 stands as a mechanism argument with **no supporting
measurement and one contrary signal**, and the build order's S3 (splitting
`adjudication.*Decided` by contested-vs-quiet) is the right way to settle it on
real play rather than on hand-built boards.

## 5. What is retired, and what is not

The three-axis carve of doc 01 predicted that ambiguity, reading and arity are
independent. The measurement uses that prediction and confirms its usefulness:
**it retires one axis and leaves the other two exactly where they were.**

| direction | status after this measurement |
|---|---|
| **mixed strategies / equilibrium reading** (R4, the game-theoretic half of S15) | **RETIRED on evidence.** Zero benefit, exactly, on the searched set, on every contacting board tried, at all three readings. And the searched set is precisely what the bot chooses among, so the verdict is directly actionable for the bot as built |
| **C-T1, the ratchet-vs-mixed-play contradiction** | **DISSOLVED, not resolved.** It was a contradiction about a member that no longer has a reason to exist. §6 records what still needs writing down |
| **`τ > 0` for ORDERING** (S14) | **untouched.** Its motivation was §2.3, which this probe does not test (finding 4c). It stands or falls on S3 |
| **set-valued arity / the Centaur case** (C-T5, doc 01 §8) | **untouched, and now standing alone.** Its argument was never game-theoretic: Γ-maximin returns one plan however sharp the belief became, and maximality returns a set that shrinks as the belief sharpens. A pure saddle does not change that by one word. It is now the *only* surviving reason to move off Γ-maximin, which makes it easier to decide rather than harder |

## 6. The honest limits, stated before anyone quotes this

1. **It is the RESTRICTED game.** Rows are what our generator proposed; columns
   are what the entanglement gate admitted (≤ 3 enemies). Adding rows raises
   both values; adding columns lowers both. A pure saddle here does **not**
   prove a pure saddle in the true game — it proves that *among the plans this
   bot chooses between and the replies this bank has found*, mixing is worth
   nothing. That is the actionable statement and it is the only one made.
2. **Nine hand-built boards, one turn each, one seat.** Not sampled from play.
   The regimes are chosen to span the program's own cost census plus the
   contested and corridor geometries, but this is a *targeted* population and a
   contrary result on sampled play would supersede it.
3. **The column set is small (1–6).** A wider gate (`gateOnEntanglement: false`,
   `enemyCap` raised) would generate more columns and could only *lower* `vMixed`
   — which cannot create a gap, since `vPure` falls too, but could change the
   saddle. Worth one confirmatory run at a widened gate before the retirement is
   treated as final.
4. **This measures the bank's floors, not the game's payoffs.** Every cell is a
   *proved lower bound* at that reply, which is the endpoint the search
   adjudicates on. The `mid` and `ceil` readings are the cross-check and they
   agree.
5. **Finding 3.3 depends on the entanglement gate**, which is a shipped policy
   and not a law of the game. A bot with the gate off would generate columns on
   the quiet boards too.

## 7. The corrected S0 specification

Superseding doc 06 §5 where they differ.

**Emit, per decision:** `restrictedRows`, `restrictedCols`, **`pureDuality`**
(lead with it — exact, solver-free, and the actual discriminator),
`vPure`, `span`, `rowMinSpread`, `distinctRowMins`, `deadCellFraction`, `bases`.
Emit `vMixed`, `rowSupport` and `colSupport` **only when `pureDuality > 0`** —
when it is zero they are computable but uninformative, and computing them costs
the only milliseconds in the increment.

**That is a strictly cheaper instrument than the one doc 06 specified**, because
the exact test comes first and the solver runs only on the decisions where the
question is live. On this evidence that will be approximately never, so the
production cost of S0 is one pass over a matrix that is already in memory.

**And `colSupport`'s other use survives the retirement**: W-1's column pruning
(doc 06 §3b) needs the equilibrium support, so a decision that *does* show
`pureDuality > 0` is exactly the decision where pruning has something to say.
The instrument stays worth shipping for that reason alone.
