# PRIOR ART 46 — determinization: the two pathologies, three measurable properties, and one parameter that keeps reappearing

Domain 12 established that decomposition under imperfect information is provably
unsound. This is the sibling question: **what happens when you search a hidden-
information game by sampling a concrete world and searching it as if it were
fully observed?** — which is what any search that conditions on a specific enemy
configuration is doing.

The literature is unusually well-formed: **two named errors**, and then a paper
whose entire contribution is **three properties, easily measured in real game
trees, that predict whether those errors will hurt.**

One of those three properties turns out to be a quantity this survey has now met
in **four** places under four names. That coincidence is the domain's main result,
and it is stated as **R-14**.

---

## 46.1 The two errors, and the three properties that predict them

**S92. Frank & Basin, "Search in games with incomplete information: a case study
using Bridge card play", *Artificial Intelligence* 100 (1998).**
**S93. Long, Sturtevant, Buro & Furtak, "Understanding the success of perfect
information Monte Carlo sampling in game tree search", AAAI 2010.**
**S94. Cazenave & Ventos, "The αμ search algorithm for the game of Bridge"
(arXiv:1911.07960).**

**Strategy fusion.** *"PIMC search (incorrectly) believes it can use a different
strategy in each world, whereas in reality there are situations (or information
sets) which consist of multiple perfect information scenarios. In the full
imperfect information game, a player cannot distinguish between these situations,
and must choose the same strategy in each one."*

  And the important refinement, which is what makes this actionable rather than
  merely alarming: **two conditions are required for strategy fusion to actually
  cause an error** — *"there must be moves which are anti-correlated values … on
  one portion of the tree, and second, there must be a move which is guaranteed to
  be better on the other side of the tree."* Absent the second, PIMC
  **over-estimates the value of the tree but still chooses correctly.**

**Non-locality.** In a perfect-information game *"the value of a game tree node is
a function only of its subtree"*. Under imperfect information it is not: the
opponent's behaviour elsewhere in the tree changes what this node is worth,
because it changes what they know. Locally optimal moves can be globally inferior.

**And then the move that makes this a design tool rather than a critique.** Long
et al. observe that the mere presence of the two errors is hard to detect and, on
its own, not enough to cause bad play. So they measure **elementary game-tree
properties that probabilistically give rise to them**:

- **Leaf correlation `lc`** — *"the probability all sibling, terminal nodes have
  the same payoff value. **Low** leaf node correlation indicates a game where it is
  nearly always possible for a player to affect their payoff even very late in a
  game."*
- **Bias `b`** — the probability the game favours one player. *"With very high or
  very low bias, we expect there to be large, homogeneous sections of the game, and
  as long as a game-playing algorithm can find these large regions, it should
  perform well."*
- **Disambiguation factor `df`** — *"how quickly the number of nodes in a player's
  information set shrinks with regard to the depth of the tree. For instance, in
  trick-taking card games, each play reveals a card … Conversely, in a game like
  poker, no private information is directly revealed until the game is over."*

*"All of these properties can easily be measured in real game trees."* And they
are: the paper shows the three predict PIMC's strength across real domains.

---

## 46.2 R-14 — leaf correlation is the one parameter, and this survey has now met it four times

Put the four side by side:

| domain | field | the condition, in that field's words |
|---|---|---|
| **40** | minimax pathology | Beal's assumption 4: *node values within a level are **independent***. The resolution five groups reached: *"position values are **not independent of each other**"* — the similarity of nearby positions. |
| **45** | real-time heuristic search | pathology's residue after learning and compute-normalisation are removed, driven by the heuristic's error structure over neighbouring states |
| **46** | determinization | **`lc`, leaf correlation** — *"the probability all sibling, terminal nodes have the same payoff value"* |
| **31 §31.5** | our own measurement | king-present cells: mean \|residual\| **1.946** vs no-king **0.201**; `corr(king, residual) = +0.954` — a **9.7× discontinuity between structurally adjacent plans** |

> **R-14. Whether more search helps is governed, in three independent search
> paradigms, by ONE quantity: the correlation between the values of sibling
> options. High correlation — search helps and the evaluator's noise averages out.
> Low correlation — the selection operator picks the noise, and more search makes
> it worse. The quantity is measurable on a replay archive, it is not measured, and
> our own evidence says it is low exactly where the game is decided.**

  Three things follow from stating it once rather than three times:

  - **One measurement serves all three domains.** d40's M103, d45's C92/C94 and
    this domain's prediction are the same experiment: correlate the values of
    structurally adjacent plans, **stratified by the mechanism indicators the value
    lens already derived**. That collapses three separate recommendations into one
    script.
  - **It is a property of the GAME and the EVALUATOR, not of the algorithm.**
    Changing search family does not change it — d40 already recorded that UCT is
    susceptible too. So it belongs in the **instance space** (d26) as a per-cell
    column, alongside deadness, not in any search module.
  - **It has a direction of remedy.** Low `lc` is not only a warning; it says the
    return on *evaluator* work exceeds the return on *search* work in that stratum
    (d40's M105). So the same number that predicts trouble also allocates the fix.

---

## 46.3 The rest of the mapping

### C95. Strategy fusion is the error our search makes, and its two triggering conditions are checkable

Any search that conditions on a **specific** enemy configuration and then optimises
within it is doing PIMC, whatever it is called. Our hypothesis market makes this
explicit: it opens hypotheses ("the enemy pins the queen") and refines *within*
them. **The plan chosen under hypothesis A and the plan chosen under hypothesis B
cannot both be played**, and if the reduction takes a best-per-hypothesis and
combines, that is strategy fusion in its textbook form.

  **The refinement is what makes this a test rather than a worry.** Frank & Basin's
  error needs *both*:
  1. **anti-correlated option values** on one part of the tree — a move good under A
     and bad under B, and its mirror;
  2. **a guaranteed-better move elsewhere** — an option that wins under every
     hypothesis.

  Without (2), the search **over-estimates but still chooses correctly**. Both
  conditions are computable from what the search already has: (1) is the sign
  pattern of an option's value across the open hypotheses, and (2) is *"is there a
  plan whose worst case across hypotheses beats every other plan's best case"* —
  **which is exactly the sound floor's dominance test.** So the design already
  computes half of the discriminator.

  **Design consequence, and it is small:** flag a decision as *fusion-exposed* when
  an option's ranking flips sign across open hypotheses **and** no option dominates
  on the floor. That is a one-line predicate over the bounds bank's existing output,
  and it marks precisely the decisions where a per-hypothesis argmax is unsafe.

### M116. Our disambiguation factor is high — and this is the first finding in the survey that predicts the fog architecture will WORK

`df` measures how fast the information set shrinks. The paper's two poles are
**trick-taking card games** (each play reveals a card; `df` high; PIMC strong) and
**poker** (nothing revealed until the end; `df` low; PIMC weak).

  **We are structurally much closer to the trick-taking pole.** Units move and are
  seen; territory is revealed by occupation; a hidden unit's possible positions are
  pruned every time it fails to appear somewhere it could have been. The
  conditioning ladder's own rungs (item-vanish, joint exclusion) *are* disambiguation
  events.

  This matters for two reasons and both are worth stating plainly:

  - **It is a prediction in the architecture's favour, and the survey has produced
    very few.** Most of this document's output is a warning; this one says the
    determinize-and-search family — which the fog programme is heading toward — is
    the family that works in games shaped like ours, and it says *why* in a way that
    can be checked.
  - **It is measurable directly, and the measurement is already half-built.**
    `df` = the per-turn shrink rate of the possible-position set. The belief lens's
    conditioning ladder computes the numerator of that fraction every turn. **Plot
    `|information set|` against turn number, on the archive.** A fast decay confirms
    the favourable regime; a slow one says the fog programme is in poker's regime and
    determinization needs the heavier machinery (d12's CFR-D / continual re-solving).

### M117. `bias` is the dead-cell criterion, derived from theory instead of from a detector

*"With very high or very low bias … there [are] large, homogeneous sections of the
game, and as long as a game-playing algorithm can find these large regions, it
should perform well."*

  Restated for us: **a cell whose bias is extreme cannot discriminate between
  arms**, because every competent algorithm finds the homogeneous region. That is
  precisely d26's **dead cell**, arrived at from game-tree theory rather than from
  an empirical detector — and it gives the detector a *predictor* it lacked, since
  bias is estimable from a handful of games rather than from a full arm matrix.

  And we have already measured that our bias varies by construction: the recorded
  **0.427 → 0.530 swing from spawn geometry alone** is a bias measurement in exactly
  this sense. So the instance space gains a column that is (a) cheap, (b) theory-
  backed, and (c) already partially collected — and the prediction is testable:
  **cells with extreme bias should be the ones where the arm matrix is flat.**

### M118. αμ is R-4's SEVENTH arrival, and the first one that is specifically an imperfect-information remedy

The αμ algorithm addresses strategy fusion *"by playing the same moves in all the
valid worlds during search"*, and addresses non-locality by using **Pareto fronts
as the evaluations of states, combined at min and max nodes**.

  R-4 (the reduction returns a **set with dominance conditions**, not a scalar) has
  now been reached from maximality, α-vectors with dominance regions, contrastive
  explanation, the Pareto front, the algorithm-configuration taxonomy's
  `set configuration` output, absorption-dominant strategies in a game's own value
  backup (d38), and now this. **Seven independent arrivals.**

  This one is different in kind from the other six and the difference is the point:
  **it is not a parallel construction, it is the published fix for the exact
  pathology our search is exposed to.** A scalar per state cannot represent "good
  under hypothesis A, bad under hypothesis B"; a Pareto front over the worlds can,
  and combining fronts at min and max nodes is what stops the search fusing
  strategies it cannot actually play.

  So R-4 is no longer only an argument about the *Centaur surface* and *explanation*.
  **It is a soundness requirement for search under fog**, and it is the same object.

---

## 46.4 The counter-argument

1. **We are not doing PIMC in its pure form.** Our bank keeps *sound bounds over a
   set of worlds*, which is closer to αμ's Pareto front than to a sampled
   determinization — and the sound floor's `min` over hypotheses is precisely the
   "same move in all worlds" discipline αμ prescribes. **That is a genuine and
   important defence**, and it locates the exposure precisely: **the sound channel
   is not fusion-exposed; the advised channel is**, because that is where a
   per-hypothesis best is taken. C95's flag therefore belongs on the advised
   reading only.

2. **`lc`, `b`, `df` are defined on a game tree with terminal payoffs, and we cut
   off at a rung with a heuristic.** The definitions need re-expressing over
   *evaluated* rather than *terminal* nodes, which changes `lc` from a property of
   the game to a property of *the game as seen through our evaluator* — arguably a
   more useful quantity, and exactly what d31's residual measurement already probes.
   This is a re-derivation, not an obstacle.

3. **Simultaneity again.** These results assume alternating moves and a chance node
   that deals the worlds. Our hidden state is not dealt once; it evolves. The
   `df` argument survives (information sets still shrink as units are observed), and
   the strategy-fusion argument survives (we still cannot play different plans in
   indistinguishable states). Non-locality's precise form needs re-derivation.

---

## 46.5 Verdicts

- **ALL — R-14: whether more search helps is governed, in three independent search
  paradigms, by ONE quantity — the correlation between the values of sibling
  options.** Minimax pathology calls it *node-value independence*; real-time search
  finds it in the heuristic's error structure; determinization calls it **leaf
  correlation `lc`**; and our own value lens measured a **9.7× discontinuity between
  structurally adjacent plans** at the king-present boundary. **One measurement
  serves all three domains** — correlate structurally adjacent plans' values,
  stratified by the mechanism indicators already derived — so three separate
  recommendations collapse into one script. It is a property of **the game and the
  evaluator, not the algorithm**, so it belongs in the **instance space** as a
  per-cell column; and it carries its own remedy direction, because low correlation
  means evaluator work out-returns search work in that stratum.
- **BELIEF / SEARCH (C95) — strategy fusion is the error our hypothesis market is
  exposed to, and its two triggering conditions are already computable.** The error
  needs **both** anti-correlated option values across hypotheses **and** a
  guaranteed-better option elsewhere; without the second, the search over-estimates
  but still chooses correctly. Both are available from the bank's output — the sign
  pattern of an option's value across open hypotheses, and *"does any plan's worst
  case beat every other plan's best case"*, which is the **sound floor's dominance
  test**. **Flag a decision as fusion-exposed when an option's ranking flips sign
  across hypotheses and no option dominates on the floor** — a one-line predicate
  that marks exactly where a per-hypothesis argmax is unsafe. Scope it to the
  **advised** channel: the sound floor's `min` over hypotheses is already αμ's
  "same move in all worlds" discipline.
- **BELIEF `[+]` (M116) — our disambiguation factor is high, and this is one of the
  survey's very few findings that predicts the architecture will WORK.** `df` is how
  fast the information set shrinks; the poles are trick-taking games (fast, PIMC
  strong) and poker (slow, PIMC weak), and we are structurally near the trick-taking
  pole — units move and are seen, and the conditioning ladder's rungs *are*
  disambiguation events. **Measure it: plot `|information set|` against turn number
  on the archive.** Fast decay confirms the favourable regime; slow decay says we
  are in poker's regime and determinization needs d12's heavier machinery.
- **MEASUREMENT (M117) — `bias` is d26's dead-cell criterion, derived from theory.**
  Extreme bias produces large homogeneous regions that every competent algorithm
  finds, so **an extreme-bias cell cannot discriminate between arms**. That gives the
  dead-cell detector a *predictor* rather than only a diagnosis — and bias is
  estimable from a handful of games rather than from a full arm matrix. We have
  already measured that it varies (**0.427 → 0.530 from spawn geometry alone**).
  Testable prediction: **extreme-bias cells are the ones where the arm matrix is
  flat.**
- **VALUE / SEARCH (M118) — αμ is R-4's SEVENTH arrival, and the first that is
  specifically an imperfect-information REMEDY.** It fixes strategy fusion by
  *"playing the same moves in all the valid worlds"* and non-locality by using
  **Pareto fronts as state evaluations, combined at min and max nodes**. A scalar
  per state cannot represent *"good under hypothesis A, bad under hypothesis B"*; a
  front can. **So R-4 is no longer only an argument about the Centaur surface and
  explanation — it is a soundness requirement for search under fog**, and it is the
  same object.
