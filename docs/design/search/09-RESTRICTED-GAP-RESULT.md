# 09 — restrictedGap, measured (v2): the retirement survives on a much thinner base, and §2.3 is confirmed

SEARCH-THEORY lens, document 9, **second revision**. Increment **S0**, built and
run. Probe: `probes/restricted-gap.probe.ts`.

**This document supersedes its own first version wholesale.** v1 computed the
matrix cells the wrong way; the correction changed every number by orders of
magnitude, confirmed a prediction v1 had recorded as untested, and left the
headline verdict standing on a base far thinner than v1 claimed. The v1 numbers
should not be quoted. §2 records the defect, because how it was found is the
most transferable part of this document.

**Verdict, in one line: `pureDuality = 0` on every board that admits the
question — so mixing still buys nothing — but only two of fifteen boards admit
the question non-trivially, and the reason the others do not is itself the
larger finding: on contested boards MOST OR ALL PLANS ARE REFUTED, so the
security value cannot order them at all.**

---

## 1. What changed between v1 and v2

Two corrections, one of them mine and one of them the red team's, plus six new
boards.

| | v1 | v2 |
|---|---|---|
| **cell** | `sub.resolveBoundedFull(row ⊕ replies)` — a bare resolve | **`bank.price(row ⊕ replies)`** — the same `BoundBank` that generated the columns |
| **DEAD** | mapped to a sentinel; maximin taken over the sentinel matrix | **rows containing a DEAD cell are REFUTED and excluded**; the game is played on the live sub-matrix; no sentinel |
| **boards** | 9, none with a lethal cell | **15**, including forced mutual kill (1v1 and 2v2), king contest, slider dodge (1 and 2 units), king-in-ray |
| **structural zeros** | not flagged | `cols < 2` flagged: a one-column matrix cannot have a duality gap for **any** payoffs |

## 2. The defect in v1, and how it surfaced

The red team's round-4 objection was that the nine v1 boards had `deadFrac = 0%`
— no lethal outcome anywhere — while textbook mixing needs DEAD-grade punishment
cells. Adding lethal boards did **not** fix it: mutual-kill and king boards still
came back `0%`. That is what forced the diagnostic, and the diagnostic found the
defect was mine, not the boards'.

Forcing a 1v1 head-on and printing every world:

```
our head 7,8   their head 7,6   shared destination: 7,7

ours-> 6,8  bankFloor  -0.16      rung B0 | per-reply 7,5:3.00  6,6:0.00  8,6:0.00  7,7:0.00
ours-> 8,8  bankFloor  -0.16      rung B0 | per-reply 7,5:3.00  6,6:0.00  8,6:0.00  7,7:0.00
ours-> 7,9  bankFloor  -Infinity  rung B0 | per-reply 7,5:0.00  6,6:-3.00 8,6:-3.00 7,7:-3.00
ours-> 7,7  bankFloor  -Infinity  rung B3 | per-reply 7,5:3.00  6,6:0.00  8,6:0.00  7,7:0.00
```

**The bank's floor for the contesting move is `−∞`. Every world v1 priced for
that same move is finite, and its minimum is `0`.**

The reason: a bare `resolveBoundedFull(row ⊕ replies)` is a **B2-shaped world** —
the witness's units move, everything else is held, and no rung ladder runs. The
bank's floor is the **max over B0/B1/B3**, which enumerates gated units and finds
killing replies the single-witness splice never reaches. So v1's cells were
systematically **optimistic**, and optimistic in exactly the place the question is
about.

> **The transferable lesson, and it is Law D1 read backwards.** v1 measured a
> quantity that *looked* like the one the search adjudicates on and was not. The
> guard that would have caught it is the one this lens keeps recommending to
> others: **a number must carry which mechanism produced it.** A cell labelled
> "the floor of row *a* against reply *b*" that was not produced by the thing
> that computes floors is a projection error, and it is the same shape as the
> precision-laundering and floor-into-mean-slot findings in docs 01 and 04.
> I made it while writing the document that names it.

**v2's cell is `bank.price(row ⊕ replies)`**: the enemy units named by the
witness are fixed as actions, the bank stays pessimistic about everything else,
and the value is the floor of that sub-game. On a 1v1 board there *is* nothing
else, so the cell is exact; on a 3v3 board fixing one enemy leaves two held, so
the cell is the honest "value of (a, b) given we do not know the rest" — which
is what a column of *partial* replies means.

## 3. The table (v2)

```
board            reading rows cols dead vPure    minMax   pureDual gap  span    rowMinSp #rowMin #argCol live   rowSup colSup
------------------------------------------------------------------------------------------------------------------------------
quiet-snake6     —       16   0    —    —        —        —        —    —       —        —       —       —      —      —      no columns
hub-queen        floor   24   1    0%   114.199  114.199  0        0    72.944  72.944   13/24   1/1     24/24  4      1      STRUCTURAL ZERO
hub-knight       —       12   0    —    —        —        —        —    —       —        —       —       —      —      —      no columns
hub-plain        —       12   0    —    —        —        —        —    —       —        —       —       —      —      —      no columns
contested-3      floor   17   6    34%  -31.319  -31.319  0        0    0.229   0.047    2/17    1/6     2/17   1      1
                 mid                    -31.234  -31.234  0        0    0.141   0.044    2/17    1/6     2/17   1      1
                 ceil                   -31.149  -31.149  0        0    0.053   0.041    2/17    2/6     2/17   1      5
contested-queen  —       23   5    —    —        —        —        —    —       —        —       —       0/23   —      —      ALL ROWS REFUTED
duel-food        —       3    0    —    —        —        —        —    —       —        —       —       —      —      —      no columns
duel-bare        —       3    0    —    —        —        —        —    —       —        —       —       —      —      —      no columns
corridor         —       13   5    —    —        —        —        —    —       —        —       —       0/13   —      —      ALL ROWS REFUTED
mutual-kill-1v1  floor   4    1    50%  0        0        0        0    0.006   0.006    2/4     1/1     2/4    1      1      STRUCTURAL ZERO
mutual-kill-2v2  floor   13   5    37%  -31.570  -31.570  0        0    0.109   0        1/13    1/5     1/13   1      1
king-contest     —       7    0    —    —        —        —        —    —       —        —       —       —      —      —      no columns
slider-dodge-1   floor   3    2    33%  23.238   23.238   0        0    0.005   0        1/3     1/2     2/3    2      1
slider-dodge-2   floor   7    1    0%   53.869   53.869   0        0    32.131  32.131   6/7     1/1     7/7    4      1      STRUCTURAL ZERO
king-in-ray      floor   7    1    0%   33.743   33.743   0        0    3.743   3.743    4/7     1/1     7/7    3      1      STRUCTURAL ZERO
```

`live` = rows with no DEAD cell against any banked column; everything left of it
is computed on those rows only. `#argCol` = distinct columns that are the argmin
for some row — **1 means the opponent has a plan-independent best reply**, i.e. a
dominant column, and a dominant strategy on either side gives a pure saddle *by
definition*.

## 4. The three findings

### 4.1 The retirement survives — on two boards, not nine

`pureDuality = 0` wherever it is computable, at every reading. But the base is
much thinner than v1 claimed, and the red team was right to say so before it was
quoted:

- **6 boards produce no columns** (no contact — the question is not posed);
- **4 boards are structural zeros** (`cols = 1`; a one-column matrix cannot have
  a duality gap for *any* payoffs, so a zero there is arithmetic, not evidence);
- **2 boards have every row refuted** (`contested-queen`, `corridor`) — the
  maximin is `−∞` and the question is moot;
- **`mutual-kill-2v2` has 1 live row**, and a one-row matrix is a second kind of
  structural zero;
- which leaves **`contested-3` (2 live rows × 6 columns)** and
  **`slider-dodge-1` (2 live rows × 2 columns)** as the only boards where a
  duality gap was arithmetically possible and did not appear.

> **Corrected verdict.** The mixed-strategy direction stays retired *for the bot
> as built*, because on every board where the question is posed the answer is
> zero — but the evidence is **two informative boards**, not nine, and both are
> 2 × small. This is now a *weak retirement*: enough to stop the direction from
> being built next, not enough to close it permanently. The confirmatory run the
> red team asked for (widened `enemyCap`, `gateOnEntanglement: false`) matters
> more after v2 than before it, because a wider gate is the one lever that
> would enlarge both live-row and column counts at once.

### 4.2 §2.3 IS CONFIRMED — and this is the larger finding

Doc 09 v1 §4(c) recorded my own floor-saturation prediction as **untested**, with
one contrary signal. v2 reverses that.

> **On `contested-queen` and `corridor`, EVERY row is refuted: every plan in the
> row set has a banked reply that drives its floor to `−∞`.** On `contested-3`,
> 15 of 17 rows are refuted and the two survivors are separated by **0.047 weight
> units** in row-min. On `mutual-kill-2v2`, 12 of 13 are refuted.

That is exactly §2.3's mechanism, measured: on contested boards the proved floor
cannot order the plans the search is choosing among, because it is `−∞` for
almost all of them. `better()`'s `cmp.order` rung cannot fire between two refuted
plans, so adjudication falls through to `est`, then the declared O-P1 ceiling
hole, then the salted tie key — **precisely where the decision is hardest.**

Three consequences:

1. **The fourth path to inert-weight cause (b) is real** (doc 05 §2.3): the
   reduction flattens the floor upstream of the evaluator, so no evaluator
   improvement restores the gradient. This belongs in the composition/value
   lenses' taxonomy as a measured cause, not a hypothesised one.
2. **The `τ > 0` ORDERING motivation is strengthened, not retired.** Doc 09 v1
   left it "untouched but untested". It is now *supported*: any non-vacuous
   reduction is finite where a min over a refuting reply is `−∞`, so it restores
   an ordering where today there is none. That is a benefit entirely independent
   of the mixing question — which is what the three-axis carve predicted and is
   now the axis's main empirical support.
3. **S3 gets a prior.** Splitting `adjudication.*Decided` by contested-vs-quiet
   on real play should show `floorDecided` collapsing on contested decisions. If
   it does not, these hand-built boards are unrepresentative and *that* is the
   finding.

### 4.3 The opponent frequently has a dominant column, which explains the saddle

`#argCol = 1` on `hub-queen`, `contested-3` (floor and mid), `mutual-kill-1v1`,
`mutual-kill-2v2`, `slider-dodge-1`, `slider-dodge-2`, `king-in-ray` — the same
banked reply is the argmin for **every** row.

> A plan-independent best reply is a **dominant strategy for the minimiser**, and
> a game in which either side has a dominant strategy has a pure saddle point by
> definition. So the zero gap is not luck: on these boards the opponent's
> punishing move is driven by **geometry** (occupy the contested cell, hold the
> ray) rather than by any rock-paper-scissors interaction with our choice.

This is a mechanism, not another symptom, and it is the most portable thing in
the document: **mixing pays only where the opponent's best reply depends on what
we do.** It also names precisely what a confirmatory run should look for — a
board where `#argCol > 1` on a live sub-matrix with ≥2 rows and ≥2 columns —
and it explains why the red team's suspicion about the column generator was
right in substance: B1/B3 bank the argmin per group, and where that argmin is
plan-independent the column set converges to one dominant reply no matter how
many rows are priced.

## 5. Honest limits (v2)

1. **Two informative boards.** §4.1. The retirement is weak, not final.
2. **Cells are sub-game floors, not game payoffs.** Fixing one enemy leaves
   others held, so a cell is pessimistic about the unfixed remainder. That is the
   correct reading of a partial-reply column and it is *not* the same as the
   payoff of a full joint profile.
3. **Refuted rows are dropped, not scored.** That is the principled treatment of
   `−∞` and it is also why `live` collapses; a design that wanted to *choose
   among* refuted plans would need a secondary order, which is exactly what the
   tie-break ladder is and exactly what §4.2 says is doing the work today.
4. **Fifteen hand-built boards, one turn, one seat, not sampled from play.**
5. **The entanglement gate shapes the column set** and is a shipped policy, not a
   law of the game. §4.1's confirmatory run is the test.

## 6. The corrected S0 specification

Unchanged from v1 in shape, with three additions v2 forces:

- lead with **`pureDuality`** (exact, solver-free), and emit `vMixed` /
  `rowSupport` / `colSupport` only when it is `> 0`;
- **emit `liveRows / rows` unconditionally.** It is cheap, it is the direct
  observable for §4.2, and on this evidence it is more informative than the gap
  it was built to support;
- **emit `distinctArgminCols`.** One integer, and it is the mechanism test:
  `1` means the opponent's reply does not depend on our plan, which is when
  mixing provably cannot pay;
- **flag `cols < 2` and `liveRows < 2` as structural zeros** in the emission
  itself, so a downstream reader cannot count arithmetic as evidence — which is
  the mistake v1 invited.
