# PRIOR ART 41 — multi-player search: the pruning wall, and why the wrong model wins

Our game has **three teams**. Domain 1 surveyed *simultaneity*; domain 40 touched
MaxN in passing. Nothing has surveyed **multi-player search itself** — which is
odd, because the REDUCTION joint's member list is `{paranoid, MaxN,
share-weighted asymmetric fold}` and those are the two canonical algorithms of
this literature, chosen without reference to what is known about them.

What is known is unusually sharp, and it is bad news for one of the members on
two independent axes at once. It also turns out that **the currency work has,
as a side effect, supplied the exact precondition this literature's pruning
results require** — which nobody has noticed and which is an argument for the
share fold that has not been made.

---

## 41.1 The pruning wall

**S78. Korf, "Multi-player alpha-beta pruning", *Artificial Intelligence* 48
(1991).**
**S79. Sturtevant & Korf, "On pruning techniques for multi-player games", AAAI
2000.**
**S80. Sturtevant, "Last-branch and speculative pruning algorithms for MaxN",
IJCAI 2003; "A comparison of algorithms for multi-player games" (CG 2002).**

**MaxN** generalises minimax by giving each node a *vector* of scores, one per
player, and having the player to move pick the child maximising **their own**
component. **Paranoid** collapses the game to two players — me against everyone —
and runs ordinary minimax.

The results:

- **Pruning MaxN requires an extra assumption, and even then only half works.**
  Given *an upper bound on the sum of the players' evaluations* and *a lower bound
  on each individual evaluation*, **shallow alpha-beta pruning is possible — but
  deep pruning is not.** Deep pruning is not merely hard in MaxN; it is unsound.
- **And shallow pruning buys nothing asymptotically in the average case.** The
  best-case asymptotic branching factor under shallow pruning is
  `(1 + √(4b−3))/2 ≈ √b` — but *"an average case model predicts that even under
  shallow pruning, the asymptotic branching factor will be **b**"*, i.e. **no
  asymptotic gain at all**. This *"compares poorly with the 2-player best-case
  asymptotic branching factor of √b, which can very nearly be achieved in
  two-player games."*
- **Paranoid gets alpha-beta back** precisely because it reduces the game to two
  players.
- **Speculative pruning** (Sturtevant 2003) is *"the first multi-player pruning
  algorithm that can prune any constant-sum multi-player game"* — it prunes
  branches that are only *probably* irrelevant, so it can return a wrong answer,
  with a parameter controlling how far it speculates. On Chinese Checkers the
  established techniques *"reduce average expansions at depth 6 from 1.2 million to
  100k nodes"*.

**And the empirical result, which is the one to sit with:**

> *"paranoid widely outperforms maxn in Chinese Checkers, by a lesser amount in
> Hearts, and they are evenly matched in Spades."*

Paranoid's model of the opponents is **wrong** — they are not all conspiring
against you — and it wins anyway, because the pruning it enables buys depth, and
the depth is worth more than the modelling error.

**The remaining hazard neither handles: the kingmaker.** A player whose move
determines *another* player's victory without affecting their own standing has no
preference the algorithms can model, so *"players may act irrationally from a pure
score-maximization perspective"* and may form implicit coalitions or behave
spitefully. Sturtevant's survey names opponent modelling in this setting as
*crucial and largely unsolved*.

---

## 41.2 Mapping onto our joints

### C80. Deep pruning is provably impossible in MaxN — and that is C22's wall, arrived at from a second direction

Domain 6's **C22** recorded that **interval dominance is sound at the leaf and
unsound propagated up the deep channel**. That was diagnosed as an artifact of our
particular bound arithmetic. It is not: **it is a theorem about multi-player
backups.** Korf's result says deep pruning cannot be made sound in MaxN at all —
with or without our interval machinery — and the reason is structural: a bound on
*my* component says nothing about the component the intervening player is
maximising, so a cutoff that skips over another player's decision node is not
justified.

  Two consequences:
  - **C22 is not a bug to be fixed.** It is the correct behaviour of the
    algorithm the REDUCTION joint selected. The design should stop looking for the
    arithmetic that would make deep propagation sound and instead treat
    shallow-only as the licensed regime — or change the member.
  - **The cost is not marginal.** Average-case asymptotic branching factor `b`
    versus a two-player search's near-`√b` means MaxN roughly **squares the node
    count for a given depth**. For a joint search that already has a `512` cap
    binding on 5–6 unit components (d17), that is the difference between the cap
    binding occasionally and binding always.

### C81. The member whose model is WRONG wins, and the reason is our own discipline

*"Paranoid widely outperforms maxn in Chinese Checkers."* Paranoid assumes all
opponents cooperate against you, which is false, and it wins because pruning buys
depth.

  This reframes the REDUCTION member choice in a way the joint currently does not:
  **the question is not "which model of the opponents is truer" but "which model
  buys more depth per unit of modelling error".** And the answer in the closest
  studied analogue is the **pessimistic** one — which is the same discipline the
  sound floor already embodies at the value layer. The architecture is already
  committed to *"a pessimistic statement you can compute cheaply beats an accurate
  one you cannot"*; this says the same principle governs the search operator, and
  the field has measured it.

  **The scoping matters and cuts the other way in one place.** Sturtevant's own
  numbers say the gap is domain-dependent: wide in Chinese Checkers, small in
  Hearts, nil in Spades. So this is a *member selection with a stated condition*,
  not a verdict — and the condition is roughly *how much the third player's
  interests actually diverge from adversarial*. In a game with a shared resource
  (board area) that all three teams contest, adversarial is a *good* approximation;
  in one with a kingmaker structure it is a bad one. **Which we are is measurable
  on the archive** (does third-team behaviour correlate with harming the leader?),
  and it decides the member.

### C82. The kingmaker is a three-team hazard neither member models, and we already have its symptom

*"A player's move can determine another player's victory without affecting their
own standing"* — the player has no preference over the outcomes that matter most
to everyone else, so no score-maximising model predicts them.

  The programme already has the symptom on record as **the three-team balance
  bug**, which R-1 reframed as a member selection. This says the reframing is
  right but incomplete: **it is not only that our reduction has one member; it is
  that neither of the two canonical members can express the kingmaker case at
  all.** MaxN assumes the third team maximises its own score (but in a kingmaker
  position its score is unaffected either way, so MaxN's prediction is arbitrary —
  it will pick whichever child the tie-break happens to favour). Paranoid assumes
  the third team is against us (which in a kingmaker position is a *specific* and
  falsifiable prediction, and at least a safe one).

  **So paranoid is not merely faster here — it is the only one of the two whose
  behaviour in the kingmaker case is defined.** That is a third argument for it,
  independent of pruning and of pathology, and it is the one the survey would not
  have found without looking at the multi-player literature specifically.

### M107. Our share currency supplies the precondition multi-player pruning REQUIRES — and nobody has said so

Korf's shallow-pruning result is conditional: it needs **an upper bound on the sum
of the players' evaluations** and **a lower bound on each individual evaluation**.
In a general multi-player game those are extra assumptions that may not hold.

  **In the share currency they are identities.** `sharePar = K·w/W`: shares are
  non-negative and sum to a constant by construction. So the sum bound is exact
  (not bounded — *equal*), and the per-player lower bound is zero.

  This is a substantive and previously unstated architectural argument:

  > **Pricing in shares is not only an accounting convenience. It is the condition
  > under which multi-player pruning is licensed at all.** An unnormalised
  > evaluation has no sum bound, and without a sum bound MaxN cannot be pruned even
  > shallowly.

  Two follow-ons:
  - it upgrades the currency work from "makes numbers comparable" (d32's accounting
    verdict) to "**enables the search**" — an effect on behaviour that d32's
    accounting/policy test would otherwise have classified as inert, because it
    acts on *what gets computed* rather than on the ordering of what is computed;
  - it makes the constant-sum property something to **preserve deliberately**. Any
    future term that breaks the sum (a bonus not taken from another team's share,
    an unnormalised safety penalty) silently removes the pruning licence, and
    nothing would report it. **R-6: assert `Σ shares = K`.**

### M108. Speculative pruning is a member with a stated failure direction, and our game qualifies

*"The first multi-player pruning algorithm that can prune any **constant-sum**
multi-player game"* — and per M107 ours is constant-sum in the fold's own
currency. Speculative pruning prunes branches that are only probably irrelevant,
so it can return a wrong answer, governed by a speculation parameter.

  That is exactly ruling 49's member shape: a technique admitted with its failure
  direction named and a dial that trades soundness for nodes. And it composes with
  the architecture's existing discipline better than most imports, because the bank
  already distinguishes a **sound** reading from an **advised** one: speculative
  pruning belongs in the advised path, and the sound path keeps shallow-only
  pruning. **The two-reading split is what makes an unsound-but-fast pruner safe to
  adopt**, which is another payoff from a decision made for other reasons.

### M109. The member choice is not a module — it is already embedded in the backup operator

`backupMin` over the enemies **jointly** is paranoid. A per-enemy maximisation is
MaxN. So REDUCTION's member selection is not something that can be layered on top
of the bounds bank; it *is* the definition of the min-node operator, and the
bank's soundness argument is a different argument for each.

  Concretely: the pruning licence, the deep-propagation soundness (C80), the
  kingmaker behaviour (C82) and the pathology exposure (d40's C78) **all follow from
  which operator is at the min node**, and none of them is stated where that
  operator is written. That is R-6 again, and it is the highest-leverage place in
  the codebase to state a hypothesis: one comment at `backupMin` naming which
  member it implements and what that licenses would carry four separate results.

---

## 41.3 The counter-argument

1. **Our game is simultaneous, and this literature is sequential.** MaxN and
   paranoid are defined on alternating-move trees. In a simultaneous-move game the
   "min node" is a matrix game (domain 1's C1), not a choice, so neither algorithm
   transfers unchanged. **This is real** and it means the specific pruning
   *theorems* need re-derivation rather than citation. But the two results that
   matter survive the translation, because they are about the *structure of the
   value*, not the move order: a bound on my component still says nothing about the
   component another player maximises (C80), and a third player with no stake in
   the outcome still has undefined behaviour (C82).

2. **Three teams is the smallest interesting `n`, and the asymptotics may not
   bite.** Korf's `b` versus `√b` is asymptotic in depth; at our depths and with
   three players the constant factors may dominate. Fair — and it makes the
   measurement cheap rather than the finding weak: **count nodes per rung under the
   two operators on the archive** and the question is settled in an afternoon.

3. **Paranoid's advantage may be an artifact of the domains tested.** Chinese
   Checkers, Hearts and Spades are all games where a player's loss is broadly
   another's gain. Sturtevant's own gap ordering (wide / small / nil) is evidence
   the effect is domain-specific, and the honest position is that our domain has to
   be classified, not assumed. The classification is the archive measurement in
   C81.

---

## 41.4 Verdicts

- **SEARCH / COMPOSITION (C80) — C22 is a theorem, not a bug.** *Deep pruning is
  provably impossible in MaxN*; only shallow alpha-beta pruning is available, and
  only given a sum bound. So "interval dominance is sound at the leaf and unsound
  propagated up the deep channel" is **the correct behaviour of the algorithm the
  REDUCTION joint selected**, not an arithmetic defect to be fixed. Stop looking
  for the arithmetic; either accept shallow-only as the licensed regime, or change
  the member. **The cost is not marginal**: average-case asymptotic branching
  factor `b` against a two-player search's near-`√b` roughly **squares the node
  count for a given depth** — which, with the `512` joint cap already binding on
  5–6-unit components, is the difference between binding sometimes and binding
  always.
- **SEARCH / REDUCTION (C81) — the member whose model is WRONG wins, and for our
  own reason.** *"Paranoid widely outperforms maxn in Chinese Checkers, by a lesser
  amount in Hearts, and they are evenly matched in Spades."* Paranoid's assumption
  is false and it wins because pruning buys depth. So the member question is not
  *which model of the opponents is truer* but **which model buys more depth per
  unit of modelling error** — the same discipline the sound floor already embodies,
  now applied to the search operator, with the field's measurement behind it. The
  gap is **domain-dependent**, so classify our domain rather than assuming: on the
  archive, does third-team behaviour correlate with harming the leader?
- **SEARCH / REDUCTION (C82) — a third, independent argument for paranoid: the
  kingmaker.** In a three-team game a team can decide another's victory without
  affecting its own standing, and **MaxN's prediction there is arbitrary** — the
  third team's score is unaffected either way, so the choice falls to a tie-break.
  Paranoid at least makes a *defined and safe* prediction. The three-team balance
  bug is this hazard's symptom, and R-1's reframing (one member is not enough) is
  right but incomplete: **neither canonical member can express the kingmaker case,
  and only one of them fails safely.**
- **VALUE / SEARCH (M107) — the share currency supplies the precondition
  multi-player pruning requires, and nobody has said so.** Korf's shallow pruning
  needs *an upper bound on the sum of evaluations* and *a lower bound on each*. In
  the share currency both are **identities**: `sharePar = K·w/W` sums to a constant
  and is non-negative. So **pricing in shares is not merely an accounting
  convenience — it is the condition under which multi-player pruning is licensed at
  all.** This upgrades the currency from "inert accounting" (d32) to *enabling the
  search*, because it acts on **what gets computed** rather than on the ordering of
  what is computed — a category d32's accounting/policy test does not have. And it
  makes constant-sum a property to **preserve deliberately**: any future term that
  breaks the sum silently removes the pruning licence. **R-6: assert `Σ shares = K`.**
- **SEARCH (M108) — speculative pruning is a member with a stated failure
  direction, and our game qualifies for it.** *"The first multi-player pruning
  algorithm that can prune any constant-sum multi-player game"* — constant-sum is
  M107's identity — at the cost of possibly-wrong answers, with a speculation
  parameter. It fits the architecture unusually well because the bank already
  separates a **sound** reading from an **advised** one: **speculative pruning
  belongs in the advised path while the sound path keeps shallow-only.** The
  two-reading split is what makes an unsound-but-fast pruner safe to adopt.
- **SEARCH (M109) — the member choice is not a module, it is the min-node
  operator.** `backupMin` over the enemies *jointly* is paranoid; per-enemy
  maximisation is MaxN. The pruning licence, deep-propagation soundness (C80), the
  kingmaker behaviour (C82) and the pathology exposure (d40's C78) **all follow from
  which operator is at the min node**, and none is stated where that operator is
  written. One comment there naming the member and what it licenses would carry
  four separate results — the highest-leverage R-6 assertion the survey has found.
- **CHEAP MEASUREMENT that settles most of this:** count nodes per rung under the
  two operators on the existing archive. It resolves whether the asymptotic gap
  bites at our depths and with three players, and it is an afternoon.
