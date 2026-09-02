# 04 — The BACKUP joint: what a deep line is worth, and how it comes home

SEARCH-THEORY lens, document 4. Owns design question (5): *scout threads with
max-min backup at `sigmaOfPly` precision — compare against the standard backup
rules; is there one backup joint whose members are the alternatives?*

Answer: yes, and the joint has **four** slots, not one. Naming them separately
matters because three of the four are currently at defensible members and the
fourth contains a defect that is invisible while they are conflated.

---

## 1. What our depth layer actually does, stated exactly

One thread per `(cluster, ply-1 proposal)`. At each ply:

1. resolve the current plan → `Resolution`;
2. `continueFrom` builds a ply-(n+1) root (shell 1 in-cluster live, shell 2 held
   as clouds with `heldAtTurn` carried so staleness grows by exactly the ply);
3. `scoreOptions` computes `max_a min_b` over **sampled** joints: up to 6 for
   us, up to 4 for in-cluster enemies, each unit's options trimmed to
   `slice(0, 3)`; the leaf value of each `(a, b)` pair is
   `resolveBoundedFull(...).bounds.worst` — a **proved floor**;
4. the argmax row's plan becomes the line the next ply continues from
   (`this.lines`);
5. `sigmaOfPly` computes a per-ply model error from `(world, spread, ourMiss,
   theirMiss, fog, interfere)`, added in quadrature;
6. for roots the coordinator actually offered, publish
   `{ value: scored.best.lo, sigmaSq: prior + σ², plies: ply + 1, root }`;
7. `core.ts::better` folds that into the branch's `BranchPosterior` at
   `precisionOfSigma(σ) = 1/σ²`, and the resulting `µ` adjudicates **among
   floor-undominated rivals only**.

Three structural properties follow, and only the third is written down anywhere.

**(a) It is not a tree.** Exactly one child is expanded per ply — the argmax
line. So `max` over siblings never combines anything: it *selects a successor*.
The published value is the value at the **deepest ply reached**, not a value
backed up through intermediate nodes. Siblings live in *different threads with
different roots*, and the only place they are ever compared is `better()` at
ply 1.

The honest name for this is **iterative deepening along one line per root** —
a principal-variation probe — and it is a perfectly reasonable shape for a
tithe-sized budget. But it means the phrase "max-min backup" describes the
*node* operation, not the *tree* operation, and a reader who expects a
refutation at ply 4 to change which sibling is chosen at ply 2 will be
disappointed: there is no ply-2 sibling to change to.

**(b) Depth is arithmetically self-limiting.** `sigmaSq` accumulates over plies,
so precision falls roughly as `1/(d·σ̄²)`. A refutation found at ply 4 therefore
moves `µ` less than the same refutation found at ply 2, by construction. That is
*honest* — model error really does accumulate — but the consequence should be
stated: **the marginal decision-value of a ply falls at least as fast as `1/d`
before any board effect is considered.** Which gives a prediction worth checking
against the measured depth-effect rate:

> **Prediction B-1.** `depthChangedPlan` rate, conditioned on the depth reached,
> should fall approximately like `1/d`. If it falls *faster*, the extra decay is
> a board effect (lines stop discriminating) and the ply cap is roughly right.
> If it falls *slower*, `sigmaOfPly` is over-charging and the accumulation rule
> — quadrature over plies, with no correlation term — is the suspect.

The suspect is specific: per-ply errors are added **as if independent**. They
are not: the same cloud saturation and the same enumeration truncation persist
across the plies of one thread, so the errors are strongly positively
correlated. Adding correlated errors in quadrature **under**-states the total,
which pushes the other way. Two identified biases in opposite directions is
exactly the situation where the measurement is worth more than the argument.

**(c) The combiner is a strictly better version of a published one.** See §2.

## 2. The literature: which backup rule is ours

| rule | node operation | who | relation to us |
|---|---|---|---|
| **minimax** | `max_a min_b` over *all* children, propagated up | classical αβ | our node operation, over a *sample* of children, one level only |
| **max^n** | each player greedily maxes their own component | Sturtevant 2008; **OpenSpiel's `mcts.py` uses this and says so** | *not* ours, and it is what a naive multiplayer extension would give. Relevant: our boards are sometimes 3-team, and the value lens found the symmetric balance form is definitionally wrong on 3-team boards. A 3-team backup is an open member |
| **MC average** | running mean of simulation returns | UCT | not ours; the known bias (converges to max only asymptotically) is the reason we do not want it |
| **stage-NE backup** | solve the stage matrix at each simultaneous node | Bosanský et al. AIJ 2016, backward induction with pruning | the **correct** rule for simultaneous moves; not ours; see doc 01's reading axis |
| **MCTS-Solver** | proven win/loss values propagate exactly and prune | Winands, Björnsson & Saito 2008 | **partially ours**: `refutedAt` is a proven-dominance veto, and the bank's B2 witness certificates are proven upper bounds. We have the mechanism and use it only at ply 1 |
| **implicit minimax backups** | keep the heuristic-minimax value and the simulation value in **separate channels**, combine at selection | Lanctot, Winands, Pepels & Sturtevant, CIG 2014 (arXiv:1406.0486) | **this is our shape.** Their two channels are win-rate and heuristic minimax; ours are the proved `(worst, best, est)` interval and the deep `(value, σ)` |
| **α-family unified backup** | one parameter interpolating `max`, log-sum-exp and average, with convergence-rate / approximation-error / regret bounds | Dam, D'Eramo, Peters & Pajarinen, arXiv:2202.07071 | **the shape of our member axis** on the max side |

The implicit-minimax placement deserves to be said plainly because it is a
credit to the design: **our combiner is better-motivated than the published
one.** Lanctot et al. combine their two channels with a linear mix
`(1−α)·winrate + α·minimax` where `α` is a tuned constant. We combine ours with
a precision-weighted Bayesian fold where the weight is *derived* from the line's
own discrimination state (`sigmaOfPly`) and nothing is clamped in either
direction. The file's own account of why the constant cap was deleted —
*"both were proxies for one real worry … and both expressed it as a constant,
which caps exactly the discoveries depth exists to make"* — is the argument
against their `α`, arrived at independently. That should be on the record when
this program is compared to prior art.

## 3. The joint

Four slots. The reason to separate them is that they have different soundness
obligations and different member lists.

```ts
interface Backup {
  /** (i) What ONE leaf is worth. Members: proved floor (today),
   *  interval midpoint, sound ceiling, the whole interval. */
  readonly leafReading: LeafReading

  /** (ii) How a node combines OUR children. Members: max (today),
   *  soft-max at temperature, generalised mean M_alpha, mixture. */
  readonly ourOperator: Operator

  /** (iii) How a node combines THEIR children. This is doc 01's REDUCTION
   *  joint, evaluated at a deep node. It MUST be the same joint — a decision
   *  that is worst-case at ply 1 and expectation at ply 3 is two bots. */
  readonly theirReduction: Reduction

  /** (iv) How the deep reading meets the near one. Members: precision fold
   *  (today), linear alpha-mix (implicit minimax), replacement (classical),
   *  silence (the null member). */
  readonly fold: Fold
}
```

### Law B1 — one reduction, all plies

> **`theirReduction` at every ply is the same member as the ply-1 REDUCTION.
> A search that is worst-case near and model-based far is not a search with a
> horizon; it is two bots spliced at a ply boundary, and no value it produces is
> a value of anything.**

This is not hypothetical. Today's `scoreOptions` mins over at most **4**
enumerated in-cluster enemy joints — a *narrowed support*, which doc 01 §3 shows
is the one direction that breaks the lower-prevision property. The code is
honest about it (`theirCoverage → sigmaOfPly.theirMiss` charges the narrowing
to precision) and that is the right instinct, but under Law B1 the correct
statement is that **the deep reduction is a different member from the ply-1
one, and the difference is currently expressed as a precision penalty rather
than as a declared member.** Once the ply-1 reduction is declared (doc 01's R1),
the deep one must be declared too, and the two must match or the mismatch must
be a named narrowing on the observation.

### Law B2 — a leaf reading may not change slots

> **A number produced as a bound may not be consumed as a mean, and vice versa,
> without a declared conversion.**

Which brings us to the finding.

## 4. Finding B-2: the deep channel folds a floor into a mean slot

`scoreOptions` returns

```ts
best: { lo: bestLo, est: (bestLo + bestHi) / 2, hi: bestHi }
```

and `deepen` publishes

```ts
this.deep.set(entry.key, { value: scored.best.lo, sigmaSq: …, plies: …, root: … })
```

so **`value` is `lo` — a proved floor** — and `est`, which is computed right
there, is carried into `ply.advisory` and never used as the published value.

`belief.ts::foldObservation` then treats `value` as the **mean** of a Gaussian
observation with precision `1/σ²`. A floor is not a mean. Two biases are being
composed and their relative size is unknown:

- **downward**: a floor understates the value of the position by the width of
  whatever the bounded resolve could not settle. `sigmaOfPly`'s `world` term
  *measures* that width (`(hi − lo)/2`) — and then charges it to **precision**,
  not to the **location**. So the same quantity is used to widen the
  distribution and is ignored when placing its centre.
- **upward**: `bestLo` is a `max` over 6 sampled rows. A max over `k` noisy
  quantities is an upward-biased estimator of the value of the best one — the
  **optimizer's curse** (Smith & Winkler 2006), and in game search the
  minimax-pathology literature (Beal; Nau). This bias does *not* affect
  soundness, because a max of sound floors is a sound floor. It affects the
  number's use as a **mean**, which is the use it is put to.

> **Finding B-2.** The deep channel produces a sound floor and consumes it as an
> unbiased mean. Which of `lo` and `est` belongs in the `value` slot is a
> **member choice of the `leafReading` sub-joint that nobody has made**, and the
> code computes both. The cheapest possible experiment is to publish `est`
> instead of `lo` behind a member selector and compare `depthChangedPlan` and
> the win rate; the arithmetic already exists in the same expression.

There is a pleasing symmetry with the epistemics lens's own strongest finding.
They found **precision laundering**: *"an advisory opinion inheriting
interval-earned proof-grade precision by riding the est scalar."* This is the
mirror image: **a proof-grade floor riding the advisory mean slot.** Both are
the same type error — a value crossing the sound/advised boundary without a
declared conversion — caught from opposite directions. Their value-table repair
(`{envelope, estSound, estAdvised, advisoryPrecision}` on `BankResult`) fixes
one direction; `DeepObservation` needs the same treatment and their B1 increment
should say so.

## 5. Finding B-3: the deep max is an odometer prefix, not a sample

This is a concrete defect and I believe it is the largest single one this lens
has found in the depth layer.

```ts
function enumerateJoints(domains, cap) {
  const picks = new Array(domains.length).fill(0)
  for (;;) {
    out.push(/* joint from picks */)
    if (out.length >= cap) break
    // increment the LAST domain first, carry leftwards
    …
  }
}
```

It is an odometer, truncated at `cap`, with the **last** domain varying fastest.
Called as `enumerateJoints(ours, 6)` where each unit's `options` is
`set.candidates.slice(0, 3)`.

With **one** cluster member: 3 options, cap 6 → all 3 enumerated. Fine.

With **two** members: the 6 joints are
`(0,0) (0,1) (0,2) (1,0) (1,1) (1,2)` — member 1 never reaches option 2.

With **three** members: the 6 joints are
`(0,0,0) (0,0,1) (0,0,2) (0,1,0) (0,1,1) (0,1,2)` — **members 1 and 2 are
pinned at the generator's first heuristic option for every joint the max ranges
over.** The `max` is then a max over one unit's three options with everything
else frozen at `candidates[0]`.

The same holds for the enemy side at `cap: 4`, where the min over a 3-member
enemy set explores `(0,0,0) (0,0,1) (0,0,2) (0,1,0)` — one enemy's options and a
single step of a second's.

### 5a. How often it fires is derivable from the partition's construction — no replays needed

I initially wrote this finding as needing a replay study. It does not. The
scout's cluster is `new Set(cluster.variables)` (`scout.ts:406, 488`), and
`cluster-partition.ts` defines

> `variables` is what the enumerator solves over: `members` ∪ **the sliders**,
> sorted

with the sliders being **every live slider we command, in every cluster, by
fiat**. `scoreOptions` then splits `members` by team, so `ours` is exactly our
share of that set. Therefore:

> **Whenever we command at least one slider and the cluster's component is
> non-empty, `|ours| ≥ 2` and the odometer pins at least one coordinate.**

And the sizes are already measured elsewhere in the program. The slider-board
median is **3 sliders**, so on `snake5-queen` / `headline-mix-king` /
`hazard-mix-king` a typical cluster has `1 + 3 = 4` variables of ours; with
`cap: 6` and three options each, the odometer enumerates
`(0,0,0,0) … (0,0,1,2)` — **three of four coordinates constant at the
generator's first heuristic option**, and the `max` ranges over one unit's three
options plus three joints of a second's.

That gives the sharpest possible statement of the finding's scope:

> **Finding B-3′.** The deep `max` degenerates to a near-single-coordinate scan
> **exactly on slider boards**, and is inert **exactly on trail-unit boards**
> (88.7% singleton components, no sliders → `|ours| = 1` → all three options
> enumerated). Slider boards are the boards this program has repeatedly
> identified as the hard ones: they are where `sliderCandidateCap: 4` cuts ~71
> options to four, where the weight-blind comparator's blindness "converges
> three ways on the queen", where the enumeration's per-joint cost is 4.23 ms
> against 0.42 ms, and where the pinning failure was measured. **The depth
> layer's exploration collapses on precisely the board class where every other
> lens has located the problem.**

It also gets *worse with depth*, because `expandCluster` adds units to
`entry.cluster` monotonically as a thread runs. Every admitted expansion moves
one more coordinate into the pinned prefix.

Two further things make this worse than a generic truncation:

1. **`ourCoverage` reports it as a fraction and the fraction is misleading.**
   `ourCoverage = ourJoints.length / ourSpace` = `6/27 ≈ 0.22`, which reads as
   "we sampled 22% of the space". We did not sample 22%; we enumerated a
   **contiguous slice** in which two of three coordinates are constant. A 22%
   uniform sample and a 22% axis-aligned slice have very different error
   properties, and `sigmaOfPly` charges them identically.
2. **The codebase has already fixed exactly this bug once, one function away.**
   `deepPlan`'s CL6a repair records: *"Before CL6a's repair this method took
   `candidates[0]` — the generator's FIRST heuristic option — for every member,
   so from the third turn onward a thread followed a greedily-chosen line while
   its documentation, its `argmaxMoved` and its security value all claimed the
   line the search had proved. A value of the wrong line is not a cheaper value;
   it is a different question's answer."* That is the identical defect, and it
   survives inside `scoreOptions` for every member but the last.

The fix is small and has three candidate members, which is exactly what makes it
a joint rather than a patch:

| member | what it enumerates | cost |
|---|---|---|
| **odometer prefix** (today) | a contiguous slice | `cap` resolutions |
| **round-robin single-unit** | the incumbent line, plus each member's alternatives one at a time | `1 + Σᵢ(|Oᵢ|−1)` — *linear in members*, and it is exactly the sweep's own neighbourhood, at depth |
| **seeded sample** | `cap` joints drawn from the same Gumbel machinery `optionsOf` already uses | `cap`, and it makes `ourCoverage` mean what it says |
| **exact, via the cluster enumerator** | the order-2 surrogate solve, conditioned on the held shell | µs on the surrogate + `k` real resolutions |

The second member is almost free and is strictly better on every count: same or
lower cost for ≤3 members, every unit's options reached, and it makes the deep
max a proper 1-opt neighbourhood of the proved line rather than a slice through
one coordinate. **This is the change I would make first in the whole depth
layer.** The fourth member is the interesting one long-term, because it makes
the deep node use the same proposal machinery as ply 1 (doc 02 §5's
cluster-conditioned re-enumeration, applied at a continuation root) — one
operator, two depths.

> **Falsifier for B-3**, and it needs no games: run the round-robin member
> against the odometer on a fixed slider-board scenario set and compare
> `argmaxMoved` and `estSpread` per ply. If the argmax never moves, the sampled
> slice already contained the best row and the defect is inert (as
> `maxClusterCells` turned out to be); if it moves often, every deep value
> published from a slider board has been the value of a line the max never
> considered. §5a means the *scope* needs no measurement at all — only the
> *magnitude* does.

## 6. Finding B-4: MCTS-Solver machinery exists and is used at one ply only

`refutedAt(trial.bounds.best, incumbent.bounds.worst)` is a **proven-dominance
veto**: if a trial's sound ceiling sits at or below the incumbent's sound floor,
the trial is retired permanently, not merely down-ranked. That is exactly the
MCTS-Solver idea (Winands, Björnsson & Saito 2008) — proven values propagate
exactly and prune — and it is the only genuinely *free* pruning available to a
search with sound two-sided bounds.

It runs at ply 1, inside `accept`. At depth, nothing prunes: every one of the
`cap` sampled joints is resolved in full (`priced++` for each), including rows
that a ceiling comparison against the current `bestLo` would have retired after
their first column. `scoreOptions`'s inner loop even has the number in hand —
`worstHi` is the running min of `scored.bounds.best` for the row — so the test
is one comparison:

```
if (worstHi <= bestLo) break;   // this row can never beat the incumbent row
```

That is **alpha-beta pruning at a simultaneous-move node**, in its sound
(bound-based) form, and it costs one comparison per resolution. Bosanský et
al.'s whole exact-algorithm contribution is that such pruning is available at
simultaneous nodes and dramatically reduces the work; we have the bounds that
make it valid and do not take it.

> **Finding B-4.** The depth layer prices `1 + Σ_rows Σ_cols` resolutions per
> ply with no cutoff, while holding a sound ceiling per row that would permit an
> immediate cutoff. Adding the one-line test cannot change any published value
> (a row that could not have beaten `bestLo` does not affect `bestLo`) and
> strictly reduces `cost`, which is denominated in the scout purse's own
> currency — so it converts directly into **more plies at the same tithe**.
> It also changes `theirCoverage`, which must then be reported per row rather
> than globally, and that is the only real work in the change.

## 7. What today's code is, as a member of each slot

| slot | today's member | verdict |
|---|---|---|
| `leafReading` | **proved floor (`lo`)**, consumed as a mean | **undeclared choice.** Finding B-2 |
| `ourOperator` | `max` over an **odometer prefix** of 6 | **defective.** Finding B-3. The operator is right; the set it ranges over is not |
| `theirReduction` | `min` over an odometer prefix of 4, narrowing charged to precision | right member (matches ply-1's vacuous reduction) over a wrong set; must be re-declared when doc 01's R1 lands (Law B1) |
| `fold` | **precision-weighted Bayesian fold at derived σ** | **the strongest part of the design.** Better-motivated than the published implicit-minimax `α`-mix. Keep, cite, defend |

That table is the useful summary of this document: **one slot is excellent, one
is right-in-principle, and two contain undeclared choices, one of which is a
defect.** And the defect and the undeclared choice are both cheap to fix.

## 8. Contradictions and cross-lens asks

### C-B4 — `DeepObservation` needs the value table too (BELIEF lens)

Their B1 increment adds `{envelope, estSound, estAdvised, advisoryPrecision}` to
`BankResult` and has belief read `estSound`. Finding B-2 says `DeepObservation`
has the identical type confusion in the opposite direction. **Ask: does the
value table's type extend to observations, or only to bank results?** If only to
bank results, the laundering is fixed at one seam and left open at the other,
and the deep channel is the seam where the number crosses a *horizon* boundary
as well as a *quantifier* one — the harder of the two.

### C-T4 — the scout's purse is denominated in resolutions, and B-4 changes the exchange rate (TIME lens)

`cost = 1 + scored.priced` is the ply's price in resolution-equivalents, which
the time lens's design adopts as the universal currency. Finding B-4 reduces
`priced` without changing any value. That is *good*, and it is also a warning
for their measurement discipline: a change that alters the cost of a quantum
without altering its product invalidates every arm comparison denominated in
quanta across the change. Their own answer already exists — *"arms compared at
equal refine-quanta AND equal total-quanta"* — but this is a concrete instance
where the two denominators come apart, and it should be one of the worked cases
in their measurement-denominator question to the owner.

### C-V3 — the deep evaluator and the near evaluator must be the same member (VALUE lens)

`scoreOptions` calls `resolveBoundedFull` on the continuation substrate, which
runs the same evaluator. Good. But the value lens's result is that the score
decomposes into three weight-share-folded flows with `k` marching toward unity
as the basis completes — and the deep root's board has *different* `K/W` and
`p` (units have died, weight has moved). So a derived coefficient computed live
at ply 1 is **not** the coefficient at ply 3. **Ask: is the folded-weight
coefficient re-derived at a continuation root, or carried?** If carried, deep
values are computed under a ply-1 coefficient on a ply-3 board, which is a
premise crossing of exactly the kind Ruling 49 names. If re-derived, the deep
value and the near value are computed by two different functions and the fold in
`better()` compares them — which needs the frame coordinate the composition
lens's B1 already flags as mandatory (*"Add `frame` to the key or shadow-driven
invocation cannot be built on top"*).

### C-J4 — the backup is four joints and the composition lens's inventory has none of them

`02-JOINT-INVENTORY.md` has no entry for the depth layer's node operations. The
four slots above are all "REDUCTION-kind" in their taxonomy (each maps a
function over children to a scalar) except `fold`, which is a genuine
**MODEL**-kind lattice join between two channels. Their chief refusal ("no joint
with one member") bites here in the useful direction: `leafReading` has two
members *in the same expression* and neither is selected, which is a joint
hiding inside a field access.

## 9. Build order

| # | increment | cost | what it decides |
|---|---|---|---|
| **B0** | Finding B-3's falsifier: on the replay corpus, fraction of deep plies with `\|members\| ≥ 2`, and whether the argmax moves under round-robin vs odometer | analysis on existing replays | whether every multi-member deep value published so far has been the value of a line the max never considered. **This is the first thing to run** |
| **B1** | replace the odometer with **round-robin single-unit** in `scoreOptions` (both sides) | ~15 lines; cost is lower or equal | fixes B-3 if B0 says it fires |
| **B2** | the row cutoff of Finding B-4 (`if (worstHi <= bestLo) break`), with `theirCoverage` reported per row | ~5 lines + one accounting change | more plies at the same tithe, with no value changed |
| **B3** | `leafReading` as a declared member with `lo` and `est`, defaulting to today | one field | resolves B-2 by measurement rather than argument |
| **B4** | Prediction B-1: `depthChangedPlan` conditioned on depth reached, against `1/d` | analysis | whether `sigmaOfPly`'s independence assumption across plies is over- or under-charging |
| **B5** | Law B1 enforcement once doc 01's R1 lands: the deep reduction is declared and must match, or the mismatch is a named narrowing | small | prevents the "two bots spliced at a ply boundary" failure before any `τ > 0` ships |

B0 and B2 are both cheap and both high-information: one asks whether a whole
class of published deep values is about the wrong line, the other buys plies for
free. Neither changes a staged plan.
