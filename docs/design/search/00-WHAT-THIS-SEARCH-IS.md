# 00 — What this search IS, in the literature's terms

SEARCH-THEORY lens, document 0. This document does one job: name the algorithm
we actually run, precisely enough that published convergence and exploitability
results apply to it verbatim. Everything downstream (the joints in 05) is
derived from this placement; if the placement is wrong the joints are wrong.

Read against `src/lobster/search/core.ts`, `src/lobster/bounds/bank.ts`,
`src/lobster/search/cluster-partition.ts`, `src/lobster/search/cluster-enum.ts`,
`src/lobster/search/scout/{scout,door}.ts`, `src/lobster/kernel.ts` at
`claude/cluster-lookahead`.

---

## 1. The decision problem, stated once

At turn `t` we choose a joint action `a = (a_1 … a_n) ∈ A_1 × … × A_n` over the
units we command. Every other live unit — enemies *and* our own uncommanded
units, with no privilege for ours — chooses `b ∈ B` **at the same time**. One
whole-board `resolve` maps `(a, b)` to a successor, one `evaluate` maps that to
a scalar in weight units. So the payoff is `u(a, b)`, and the decision is a
one-shot **two-player zero-sum matrix game** whose row set is a combinatorial
product and whose column set is another.

Three structural facts fix everything else:

1. **The row space is factored and huge.** `∏|A_i|`; measured single-cluster
   estimates on the batch-2 corpus reach 1,753 claim-slots on
   `headline-mix-king` before the ration binds, and the whole-board product is
   far larger. Enumeration is out at ply 1, let alone at depth.
2. **The payoff does not decompose over that factorization.** One resolution,
   one evaluation. Any per-component value is a *surrogate*, never the payoff.
3. **The column space is worse and partly unobservable.** Fog makes `B` a set of
   possibility clouds rather than a list, which is why the bank's B0 rung
   ("hold everything") exists at all.

## 2. The name of the thing

> **Our ply-1 search is pure-strategy maximin over a factored row space,
> computed as coordinate ascent (with 2-opt and a small block-opt escape) on a
> sound *lower bound* of the security value, where the lower bound is maintained
> by the column-generation half of a double oracle.**

Three separately-citable components, and each one has literature attached.

### 2.1 The reduction over columns: a half double oracle

`bounds/bank.ts` is explicit about this and the comment is correct:

> *"The branch that achieved the minimum is a real opponent reply, so it is
> banked as a witness: this is where the double oracle's column generation
> actually happens."*

The bank's four rungs are, in game-theoretic terms:

| rung | what it is |
|---|---|
| **B0** hold everything | a *relaxation* of the min: the opponent is replaced by a set-valued hold, which is sound because holding dominates (in the bound sense) any concrete reply |
| **B1** per-enemy complete enumeration, additive | the **marginal / decoupled** lower bound on a joint min: `min_{b_e} u(a, b_e, rest held)` for each `e` separately, cost a *sum* not a product. Sound only when the sweep is WHICH-complete — the code enforces exactly that |
| **B2** witness matrix | the **restricted column set** of a double oracle. Witnesses accumulate across the whole decision and survive restarts; the file says so |
| **B3** full product within a declared cap | the exact min over the modelled subgame |

What we do **not** do is the other half of a double oracle. Bosansky, Lisý,
Lanctot, Čermák & Winands (AIJ 237, 2016, *Algorithms for computing strategies
in two-player simultaneous move games*) define the method as: maintain a
restricted row set and a restricted column set, **solve the restricted matrix
game for its mixed-strategy value**, then add a best response on each side and
repeat. We generate columns and rows, and then take the **pure** argmax of the
row-wise min. The mixed solve — the step that makes the pair of restricted sets
mean anything as an equilibrium approximation — is absent.

That absence has a name and a size. See §4.

### 2.2 The optimization over rows: better-response dynamics on an identical-interest team game

Every unit we command is scored by **one scalar** — `better()` on the bank's
floor. So our internal joint-optimization problem is an **identical-interest
(team) game**, which is an *exact potential game* in the sense of Monderer &
Shapley (1996) with potential equal to the payoff itself.

`sweep()` is a **better-response dynamic** over that potential game: pick a
unit in `sweepOrder`, try `optionsOf(unit)` one at a time, accept on strict
improvement. `pairRepair()` is **2-opt** restricted to the pairs the resolver
names as self-inflicted casualties. `jointPolish()` is exhaustive **block-opt**
over a block of ≤3 units × top-2 options. `perturb()` + re-sweep is a
one-unit-kick **iterated local search** restart.

The literature result that applies, and it is a good one:

> An identical-interest finite game has the **finite improvement property**:
> every strict-improvement path terminates, in any update order, at a **pure
> Nash equilibrium of the team game**.

So the ascent *cannot cycle* and *does* converge — but to a **1-opt local
optimum of the bank's floor over the sampled deviation sets**, not to the
maximin of the real game. The exact statement of what we converge to is:

> a joint action that is a pure Nash equilibrium of the team game whose
> deviation set for unit `i` is `optionsOf(i)` (the `candidateCap`-truncated,
> possibly Gumbel-sampled prefix of `i`'s candidate list), whose payoff is
> `floor(a)` rather than `SV(a)`, and which is additionally 2-opt on
> resolver-named clash pairs and block-opt on ≤3 contested units.

Four named gaps to the true solution concept — restricted deviations, floor vs.
security value, restricted columns, pure vs. mixed. Documents 01–04 take one
each.

### 2.3 The row generator: a coordination graph, used as a proposal operator

`cluster-partition.ts` builds the connected components of the interaction graph
`influenceOf(u) ∩ influenceOf(v) ≠ ∅` over non-sliders, augmenting every
component by fiat with every live slider we command. That object has a name in
the graphical-models and multi-agent literature: it is a **coordination graph**
(Guestrin, Koller & Parr 2002), and the slider fiat is **cutset conditioning**
(Pearl 1986) — the interaction graph is a star whose hub is a slider 89.7% of
the time, and lifting the hub out of the residual graph and conditioning on it
is exactly the standard move for making a star tractable. The file's own note
("*lifting the hub out of the residual graph and CONDITIONING on it is the same
operation as the owner's fiat*") is the right identification and deserves the
citation.

`cluster-enum.ts` then does per-component **exact enumeration on a µs
surrogate**, k-best with a Hamming diversity floor, and best-first composition
across components — with a threshold-split rung and an ICM rung as fallbacks
when the exact product is too large. ICM (iterated conditional modes) is itself
coordinate ascent on the surrogate; the file names it.

The crucial and correct design decision is that **none of this touches the
value**. Cluster results are *proposals*; every one is priced by the
unconditional whole-board bank and adjudicated by `better()`. The comparison
that matters:

- **Coordination graph as value decomposition** — `Q(s,a) = Σ_c Q_c(s, a_c)` —
  is what Guestrin et al. and the VDN/QMIX/DCG line do, and it is *unsound* here
  because one mid-turn collision couples the whole board. Castellini, Oliehoek,
  Savani & Whiteson (AAMAS/JAAMAS 2019–21, *Analysing factorizations of
  action-value networks*) measure exactly where such factorizations fail: on
  games with tight coordination requirements and sparse value structure.
- **Coordination graph as proposal generator** — what we do — has no soundness
  obligation at all, only a coverage obligation.

That distinction is the single most important thing our architecture already
gets right, and it should be promoted from an accident of the code to a **law**
(document 02, Law D1).

## 3. What the depth layer is

`scout/` opens threads at ply-1 proposals, walks a door
(`Resolution → substrate`) forward, and at each new root computes
`max_a min_b` over the *cluster's* own options (≤6 joints for us, ≤4 for
in-cluster enemies, everything else held as clouds). It publishes
`(value, sigma, plies)` for the origin branch, and `better()` folds that into a
Gaussian belief that adjudicates **among floor-undominated rivals only**.

In backup-rule terms this is not the textbook minimax backup (which replaces the
parent's value) and not the MCTS averaging backup. It is precisely the shape of
**implicit minimax backups** (Lanctot, Winands, Pepels & Sturtevant, CIG 2014,
arXiv:1406.0486): keep two sources of information — here the proved
`(worst, best, est)` interval and the deep `(value, sigma)` — **separately**, and
combine them at selection time rather than overwriting one with the other.

Our combiner is a precision-weighted Bayesian fold (`foldObservation` on
`precisionOfSigma(sigma)`) where theirs is a linear `α`-mix. Ours is strictly
better-motivated — the weight is *derived* from the line's own discrimination
state via `sigmaOfPly` rather than chosen — and it is a member of the same
family. Document 04 makes the family explicit.

## 4. The size of the pure-vs-mixed gap, and why it is our "passivity"

This is the load-bearing theoretical claim of this lens, so it is stated
carefully.

Let `M` be the restricted payoff matrix the bank *already holds* at the end of a
decision: rows = the plans it priced, columns = the banked witnesses. Define

- `V_pure  = max_i min_j M[i,j]` — what we play today.
- `V_mixed = max_{p ∈ Δ(rows)} min_j (pᵀM)_j` — the value of the restricted
  matrix game.

Then `V_pure ≤ V_mixed` always, and **the gap can be the entire range of the
matrix**. Rock–paper–scissors is the canonical witness: `V_mixed = 0`,
`V_pure = −1`. There is nothing pathological about that example here — a
simultaneous-move chess/snake hybrid with mid-turn collisions is exactly the
kind of game whose local subgames are matching-pennies-shaped (contest a cell or
not; step into the corridor or hold).

Two consequences follow, and one of them is testable for free.

**(a) The four-times-confirmed "worst-case passivity" finding is this gap.**
The pins record it as *"pure worst-case minimization structurally selects passive
play … no bound tweak fixes it"*, with the mitigation named as "depth +
opponent-model relaxation". That is right but under-diagnosed: the reason no
bound tweak fixes it is that it is not a bound problem at all. It is the
pure-vs-mixed gap of a matrix game, and the *only* things that close it are
(i) randomizing our own row, (ii) replacing worst-case with a less pessimistic
column reduction, or (iii) removing the columns from the restricted set by
proving them unreachable. Making the floor tighter moves both `V_pure` and
`V_mixed` and closes nothing.

**(b) We can measure it per decision, today, with no games.**
The matrix is already in memory: `BankResult.members` carries every branch the
bank priced and `witnessList` carries every banked column. Computing `V_mixed`
for a matrix of a few dozen rows and a few dozen columns is a tiny LP, or ~200
iterations of regret matching⁺ (Tammelin 2014) at microsecond cost — negligible
beside an 18 ms `price()`. The instrument is:

> **`restrictedGap = V_mixed − V_pure`, in weight units, emitted per decision
> alongside `floorDecided` / `depthDecided` on the mechanism report.**

This is the cheapest high-information instrument this lens can name. It answers
"how much is pure maximin costing us *right now, on this board*" without playing
a single game — which matters exactly because Ruling 49 says bot-vs-bot results
are potentially distortionary. A gap that is near zero on our boards would
*retire* the mixed-strategy direction on evidence; a gap of several weight units
would price it. Either answer is worth more than another 660-game sweep.

**(c) And it is stronger than "derivable": the matrix is already COMPUTED,
cell by cell, on every `price()` call, and thrown away.**

`bank.ts`'s B2 loop is, verbatim:

```ts
if (cfg.b2 && this.witnessList.length > 0) {
  for (const witness of this.witnessList) {
    …
    const branch = this.priceBranch(view, withMoves(base, [...witness.replies.values()]), "B2", …)
    ceilingBranches.push(branch)
    members.push({ rung: "B2", …, complete: false, floor: null, ceiling: branch.bounds.best })
  }
}
```

So for **every plan the search prices**, the bank resolves that plan against
**every banked witness** and computes `branch.bounds` — then keeps only
`bounds.best`, feeds it into a `min`, and discards the rest. That is exactly one
row of the restricted payoff matrix, computed in full and reduced to its
row-minimum on the spot.

Retaining it costs **one number per (row, column) pair** — on the measured
23×23 three-team board, 152 distinct plans against however many distinct
witnesses accumulated, i.e. a few tens of kilobytes — and **zero additional
resolutions**. The whole objection one would expect to "solve the matrix game"
(it costs simulations we cannot afford) does not apply: the simulations are
already spent.

Two refinements that make the instrument sounder than my first statement of it:

- **The entries are intervals, and the floor side is the one to use.**
  `priceBranch` returns `bounds` with both endpoints. Building the matrix from
  `bounds.worst` makes every entry a sound floor at that reply, so `V_pure` and
  `V_mixed` are computed on the *same* entries and their difference is a clean
  comparison of two reductions of one matrix — no mixing of floors and ceilings.
- **The LP pays for itself.** The equilibrium mixture's *column support* names
  the witnesses that actually matter. Everything outside the support can be
  dropped, which is the pruning step a real double oracle performs and we never
  do — see finding (d).

**(d) The witness set is uncapped and every witness is re-priced against every
plan, so `price()` gets monotonically more expensive within a decision.**

`WitnessSet` and the bank's own `witnessList` have **no capacity and no eviction
policy**. Witnesses are added in `closeGroup` (the minimiser of each B1/B3
group), de-duplicated by key, and never removed; `adoptWitnesses` deliberately
carries them across restarts and pin contexts, which is right and is what makes
them the double oracle's memory. But the B2 loop is `O(|witnesses|)` resolutions
**per priced plan**, so:

> **Finding W-1.** The cost of one `price()` grows linearly in the number of
> distinct opponent replies the decision has discovered so far. A decision that
> prices 152 plans does not price them at 152 equal costs: the last plan costs
> materially more than the first, and the growth is unbounded and unmeasured.

Three consequences, one of them cross-lens:

1. **It interacts with the kernel's adaptive slice length.** `drive` sizes a
   slice from `entry.stepCostMs * sliceCostFactor` — a *measured* cost that is
   therefore drifting upward through the turn. So slices get longer late in a
   decision for a reason that has nothing to do with the board, which reduces
   the number of points at which an operator's pin can be drained (events are
   taken between slices, never inside one). That is a **latency drift with a
   compute cause**, and the time lens's operator-latency cap is stated in
   milliseconds against a quantity that moves.
2. **A real double oracle prunes columns and we never do.** The standard
   algorithm drops columns outside the equilibrium support once the restricted
   game is solved. We keep every column for the life of the decision. Solving
   the matrix (increment R0) *produces* the support as a by-product, so the
   instrument that measures the pure-vs-mixed gap is also the thing that would
   let the bank shed columns — turning a diagnostic into a cost saving in the
   same LP.
3. **The law that keeps witnesses sound is exactly what makes them expensive**,
   and it is the right trade. `witness.ts`: *"the ascent may not choose a plan a
   witness refutes without the witness being RE-PRICED against that plan …
   reusing a verdict computed against a different plan is how a double oracle
   silently turns into a restricted game it has forgotten it restricted."* That
   is correct and must not be relaxed. Pruning by equilibrium support is the
   sound way to reduce the cost, because a column outside the support is one the
   opponent's best mixture never plays — not one whose verdict we are reusing.

**Caveat, stated because it is real.** `V_mixed` on the *restricted* matrix is
neither an upper nor a lower bound on the true game's value: adding rows raises
it, adding columns lowers it. It is a *within-the-searched-set* measurement of
how much structure the pure reduction is discarding, and that is what it should
be reported as. It also assumes the row payoffs against a *given* column are
comparable, which under our basis discipline means the matrix must be built from
branches sharing one basis — a refusal, not a clamp, when they do not.

## 5. Where each named alternative sits relative to us

| family | what it does | what we do | distance |
|---|---|---|---|
| **DUCT** (decoupled UCT; Lanctot et al.) | each player keeps a *separate* per-action bandit at a joint node; joint action = product of independent selections | our sweep is decoupled per unit but on the *same team* and with a *deterministic* accept, and the opponent side is a bound not a bandit | DUCT's decoupling is our sweep's decoupling. DUCT's known failure — it converges to a *deterministic* profile and is **not** guaranteed to reach a NE in matrix games with no pure equilibrium (Lisý, Kovařík, Lanctot & Bosanský, NIPS 2013, arXiv:1310.8613) — is *our* failure, exactly |
| **SM-MCTS with Hannan-consistent selection** (RM, Exp3) | replaces the per-player bandit with a no-regret learner; converges to approximate NE of the extensive-form game | we have no learner and no averaging | the modification is *localised*: it is the row-selection rule, not the tree. Kovařík & Lisý (arXiv:1509.00149, arXiv:1804.09045) show HC alone is **not sufficient** without either averaging over joint actions or an extra property — which is precisely a warning against a naive drop-in |
| **CFR / CFR⁺ / OOS** | regret minimisation over information sets, with counterfactual values | we have no strategy iterate at all; every decision starts from a seed | far. CFR needs many iterations over one game; we have one turn and a 1 s budget. But RM⁺ on the *restricted matrix* (§4b) is cheap and is the useful fragment |
| **Double oracle + serialized αβ** (Bosansky et al.) | restricted game, exact best responses, mixed solve, pruning | we do column generation and skip the mixed solve | one step. The step is §4 |
| **Best-response dynamics** | iterated unilateral best responses | our sweep, exactly, on the team side | identical. And the relevant theorem is the *identical-interest* one (converges, any order), **not** the general one — see §6 |
| **Coordination graphs + max-plus** (Guestrin et al.; Choudhury, Gupta, Morales & Kochenderfer, AAMAS 2021, arXiv:2101.04788, `FactoredValueMCTS.jl`) | factor the joint action space, solve joint action by variable elimination or iterative max-plus, inside MCTS | we factor and enumerate exactly per component, compose best-first | close. Their *dynamic, state-dependent* coordination graphs are what document 02 argues our boundaries should become |
| **Implicit minimax backups** (Lanctot et al. 2014) | keep heuristic-minimax and simulation values in separate channels; combine at selection | our floor-interval channel + deep `(value, sigma)` channel, combined by precision | same family, better combiner |
| **α-family / unified backups** (Dam, D'Eramo, Peters & Pajarinen, arXiv:2202.07071) | one parameter interpolating max, log-sum-exp and average backups | we are pinned at the `min`/`max` corner | this is the *shape of the member axis* for document 04's backup joint |

## 6. Two convergence claims about OUR loop, one sound and one not

### 6.1 Sound: the loop terminates and does not cycle — **when depth is silent**

With the depth rung silent, `accept()` is the strict part of a lexicographic
order on the key `(floor, est, ceiling, tieKey)` computed inside one basis, with
a *refusal* (not a preference) on basis mismatch. A strict order over a finite
set admits no cycles, so every ascent path is finite and `best === before`
means what it says: no single-unit deviation from the sampled sets improves.

That gives the honest label for our fixed point:
**a sampled-deviation pure Nash equilibrium of the identical-interest team
game induced by `floor`.**

### 6.2 Not sound: with the depth rung on, "converged" is not proved

`accept()` with `withDepth` uses **two different comparators depending on the
pair**:

```
if (refutedAt(incumbent.bounds.best, trial.bounds.worst)) return null   // rung SKIPPED
const deep = depthRung(trial, incumbent); if (deep !== null) return deep // µ decides
… otherwise floor / est / ceiling / tieKey decide
```

`beliefOf` is total (it falls back to `posteriorOfBranch(worst, best, est)` when
there is no deep note), so µ exists for every plan — but the rung is *skipped*
when either `s.deep.size === 0`, or both sides lack a note, or the incumbent
soundly dominates the trial. A relation that ranks some pairs by µ and other
pairs by `floor` is **not in general the strict part of any single preorder**,
and three-cycles are constructible: `A ≻_µ B`, `B ≻_floor C`, `C ≻_µ A`.

Two consequences, both currently unguarded:

- `if (best === before) break` in `improve` uses object identity. Under a cycle
  it never fires, the polish/restart escape is never reached, and the slice
  burns to the deadline re-accepting a rotation of the same three plans.
- The word "converged unit-wise" in that comment becomes false, and the
  telemetry that reads it (`sweeps`, `restarts`) becomes uninterpretable.

**This is not a speculation. Here is the cycle, run against the shipped
arithmetic.** `docs/design/search/probes/accept-cycle.probe.ts` reimplements
`accept()`'s control flow exactly (same order of gates, same early-outs) while
importing the **real** `posteriorOfBranch`, `foldObservation`,
`precisionOfSigma` and `refutedAt`. Dropped into
`src/lobster/__tests__/` on `claude/cluster-lookahead` and run under the repo's
own jest, it passes:

```
A = { lo: 0, hi: 12, est: 6, deep: { value: 9, sigma: 0.5 } }
B = { lo: 5, hi: 5.2, est: 5.1 }                       // no deep note
C = { lo: 4, hi: 20,  est: 19 }                        // no deep note

mu: { A: 8.958904109589042, B: 5.1, C: 15.5 }
A>B true   B>C true   C>A true
```

`A ≻ B` because both have the rung available (A has a note) and `µ_A > µ_B`;
`B ≻ C` because neither has a note so the rung returns null and the **floor**
decides (`5 > 4`); `C ≻ A` because the rung is available again and
`µ_C > µ_A`. Three accepts, one cycle, no contrived arithmetic — B is a narrow
high-floor plan, C is a wide speculative one, A is a plan depth has spoken well
of. All three are ordinary.

And the split is **systematic, not random**: deep notes are published only for
`this.offered` thread keys, i.e. exactly the cluster enumeration's own
proposals. So the comparator uses `µ` whenever a *proposal* is one of the two
and the **floor** whenever two *sweep neighbours* meet — which is precisely the
mixed-comparator condition, arising by construction on every decision the scout
reaches.

Whether it *fires often* is still empirical, and the instrument is one line:
count accept-events per plan key inside one `improve` call and report the max.
A key accepted more than once in one slice is a realised cycle.

The repair is a **law**, not a patch, and it belongs in the joint:

> **Law A1 (single-key acceptance).** The acceptance relation must be the strict
> part of a total preorder on one declared key, computed for *every* trial by
> the same rule. Dominance may VETO (refuse an accept) but may never SELECT a
> different comparator. A joint whose members are comparators must state its key
> and prove the order total.

Today's comparator becomes a member of that joint that **fails the law**, and
the smallest member that passes is: veto on sound dominance, then order by µ
always (with the no-deep-note µ being exactly `posteriorOfBranch`), then the
existing tiebreaks. That is a strictly smaller change than it sounds — it
deletes the `if (refutedAt(incumbent…)) return null` early-out and the
`deep === null` fallthrough — and it makes the fixed point provable again.

## 7. What this document commits to

1. Our search is **pure maximin over a factored row space, by better-response
   dynamics on a floor, with double-oracle column generation and no mixed
   solve**. Every one of those five phrases is a joint with members
   (documents 01–04).
2. The "worst-case passivity" verdict is the **pure-vs-mixed gap of a restricted
   matrix game**, and it is measurable per decision at negligible cost without
   playing games.
3. The cluster decomposition is a **coordination graph used as a proposal
   operator, never as a value decomposition** — sound today, and the law that
   keeps it sound must be written down before anyone is tempted to read a
   cluster score as a value.
4. The acceptance relation currently **fails to be a single order** once depth
   speaks, which makes the loop's convergence claim unproved. This is the one
   place where a published theorem we would like to cite does not yet apply to
   our code.
