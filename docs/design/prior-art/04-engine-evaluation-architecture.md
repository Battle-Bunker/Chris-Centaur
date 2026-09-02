# PRIOR ART 4 — game-engine evaluation architecture

Domain: how the strongest open-source game engines actually structure an
evaluation function, keep it cheap under incremental state change, and fit its
constants without fooling themselves. Read against the VALUE lens's
`SYNTHESIS.md` (per-unit weight accounts, the three-flow fold, one fitted k),
the COMPOSITION lens's premise-fibered values and memo namespaces, and ruling
49's distortion worry.

This is the domain with the **strongest positive corroboration** of our carve
and one sharp new hazard.

---

## 4.1 Load-bearing sources

**S10. Wu, "Accelerating Self-Play Learning in Go" (KataGo), arXiv:1902.10565
(2019), plus `KataGo/docs/GraphSearch.md`.** Auxiliary ownership and score-belief
targets; playout cap randomization; policy target pruning; and — separately —
the Monte-Carlo *graph* search correctness analysis.

**S11. Stockfish NNUE (chessprogramming.org/NNUE, official-stockfish
nnue-pytorch docs).** The efficiently-updatable accumulator, HalfKP/HalfKA
feature sets, and the king-bucket/refresh design.

**S12. Peter Österlund, *Texel's tuning method*
(chessprogramming.org/Texel's_Tuning_Method), and the Stockfish **Fishtest**
methodology (GSPRT, pentanomial scoring, paired openings).** The industrial
answer to "how do you fit evaluation constants from self-play games without
fooling yourself".

---

## 4.2 What the experts decided, and their stated rationale

### (a) KataGo: predict SUBCOMPONENTS of the target, for credit assignment

KataGo adds two domain-specific auxiliary heads on top of the value head:

- **Ownership loss**, per board point, `−w_o Σ_l Σ_p o(l,p) log ô(l,p)` with
  `o ∈ {0, 0.5, 1}` and `w_o = 1.5/b²` (b = board width — i.e. **normalised by
  board area**);
- **Score-belief loss**, twice: a "pdf" cross-entropy on the exact final score
  difference, and a "cdf" squared term that "pushes the overall mass to be near
  the final score". Both weighted 0.02.

Their stated rationale, and the sentence to carry into our design: *"consider the
task of updating from a game primarily lost due to misjudging a particular region
of the board. With only a final binary result, the neural net can only 'guess' at
what aspect of the board position caused the loss. By contrast, with an ownership
target, the neural net receives direct feedback on which area of the board was
mispredicted, with large errors and gradients localized to the mispredicted
area. The neural net should therefore require fewer samples to perform the
correct credit assignment."*

They generalise it to a **meta-learning heuristic: "predicting subcomponents of
desired targets can greatly improve training"** — and report the gain persists
to the end of runs, long after the net is strong.

Separately, the *utility* KataGo maximises is not winrate: it is a linear
combination of winrate and the expectation of a **nonlinear function of the score
difference** (re-centred at the root each search). Rationale: in a decided game
the winrate is pinned near 100% and carries no gradient across moves that are
losing points; score does. Slack endgame play and handicap play are the named
symptoms.

### (b) NNUE: the evaluation is designed around what changes between positions

The defining architectural decision, in the wiki's own framing: the network is
"structured to exploit the fact that consecutive chess positions differ only by a
small number of piece moves." The first hidden layer's pre-activation
(*accumulator*) is maintained **incrementally** — on make/unmake, the
contributions of the handful of changed input features are added/subtracted and
everything else is reused. HalfKP features `(our_king_square, piece_square,
piece_type, piece_colour)` are chosen to sit at "a sweet spot of being just the
right size, and requiring very few updates per move on average"; because the
feature is king-relative, a *king move* invalidates the whole accumulator, which
is why the design carries refresh tables and accumulator stacks.

The design law: **the feature basis is chosen for its incremental-update
footprint, not only for its expressiveness.** Only the first layer can be updated
incrementally, so it is made large and everything downstream is made small.

### (c) MCTS graph search: sharing nodes silently corrupts values

`GraphSearch.md` states the hazard precisely: when a node is shared across
transposing paths, playouts that update the shared child **do not pass through
every parent**, so a parent's utility estimate is never revised — *"because the
playouts updating node C did NOT go through node A, we did not revise our utility
estimate for node A"* — and the PUCT exploration term then prefers worse moves at
that parent, potentially indefinitely. Their fix: stop conflating child visits
with action selections. Track **edge visit counts N(n,a)** separately, and
recompute Q(n) recursively as the regularized expected utility of the posterior
policy implied by those edge counts.

### (d) Texel tuning: fit to the ground truth, freeze the scale, and say what it
cannot do

Objective: minimise mean squared error between the **game result** (0 / 0.5 / 1)
and `sigmoid(K · qsearch_score)` over millions of positions drawn from ~64,000
fast games "between the current and/or previous versions of the engine",
excluding book positions and mate scores. **K is computed once to minimise E and
"never changed again by the algorithm."** Positions are scored through
*quiescence*, and the filter that excluded positions whose q-score deviated from
the search score was **abandoned** because it cost ~39 Elo — the q-function "has
to deal with them all the time in real games", so excluding them biases the fit
toward positions the engine never faces.

Their two stated cautions are exactly ruling 49's worry, from the inside:
**"correlation does not imply causation"** (the engine may fit spurious
correlates of strength), and the method "cannot discover entirely unknown
concepts — it optimises things the engine partially already knows."

### (e) Fishtest: paired openings, pentanomial scoring, and a bias estimator

Stockfish's testing framework plays every opening **twice with colours reversed**
and scores the *pair* on a five-point scale (0, ½, 1, 1½, 2) — the **pentanomial**
model — rather than scoring games independently (trinomial). Acceptance is by
**GSPRT** with pre-registered Elo bounds. And the reason to cite it here: *"the
difference between the results predicted by the pentanomial and trinomial models
allows for an estimation of the RMS value of biases present in the opening
book."* The variance-reduction device doubles as a **measuring instrument for the
distortion of the test population itself.**

---

## 4.3 Mapping onto our joint

### AGREES — and this is the survey's strongest corroboration

- **Per-unit weight accounts ARE KataGo's ownership head.** Our fold decomposes
  `sharePar` into per-unit flows; KataGo decomposes the game result into per-point
  ownership. Same move, same rationale, independently arrived at. And KataGo
  supplies the argument our VALUE lens has not yet made: the decomposition's
  value is not only evaluator accuracy, it is **credit assignment from few
  samples**. Under ruling 49's constraint — few games, low roster density,
  possibly distorted population — that is the argument that matters most.
- **`sharePar` is a score utility, not a winrate**, and KataGo's whole
  score-utility design says that is right. Elimination-rate/win-rate metrics go
  flat exactly where our knight cell went flat (48/48 games hit the cap, `elim`
  exactly 0.000); a continuous share metric keeps a gradient there. The VALUE
  lens's M5 ("rank cells by measured sharePar SD before spending blocks") is the
  same instinct; KataGo is the citation.
- **`w_o = 1.5/b²` is KataGo normalising the ownership target by board area** —
  structurally the same move as our `(K/W)` share factor. Two independent
  designs, same normalisation, same reason: a per-unit signal must be denominated
  in a fraction of the whole so that boards of different size/roster are
  commensurable.
- **Texel freezes K after fitting it once.** Our value lens froze k = 1.227
  before the rook cell and pre-registered the forecast. That is exactly the
  discipline, and it is what makes the rook cell a real out-of-sample test.
  Worth stating that the practice has a name and a 15-year track record in a
  community that ships.

### CONTRADICTS — flag loudest

**C13. Our evaluation basis is not chosen for its incremental-update footprint,
and the time lens's whole re-base/citation design assumes it is.** NNUE's
central lesson is that *the feature set is a design variable jointly with the
update path*: HalfKP exists because it makes the per-move delta small, and the
king-relative choice's cost (full refresh on king moves) is accepted and
engineered around with refresh tables. Our design goes the other way: the VALUE
lens picks a basis on statistical grounds (three flows, R² 0.970) and the TIME
lens then asks for citation-scoped invalidation over whatever that basis turned
out to be. Nobody has asked **"what does one operator commit change in the
three-flow fold?"** — which is the NNUE question and the one that decides whether
`feature/commit-scope` recovers the 343 ms or not.

  Concretely testable now, no games needed: for each of the three flows, compute
  the fraction of per-unit account terms that change when exactly one unit's
  chosen action changes. If the fold's terms are mostly global — `(K/W)(1−p)` is
  a *whole-board* quantity, recomputed once per turn — then a single unit's
  commitment perturbs the coefficient of **every** unit's term, and citation-
  scoped invalidation buys nothing. That is a live risk created by the value
  lens's own M1 ("form (K, W, p) once per turn and use it"): the cheapest correct
  evaluator is also the least incrementally updatable one. NNUE's answer would be
  to *fix* the normaliser within a turn (it already is) and to bucket the
  accumulator by the quantity that invalidates it. Someone has to check this;
  the two lenses are optimising against each other and neither has noticed.

**C14. KataGo's graph-search hazard is our memoisation hazard, and it is the
second independent statement of domain 2's C7.** Our composition carve
deliberately shares values: an evaluation identity as memo namespace,
premise-fibered values reused across joints and comparator rungs. KataGo's
finding is that when a value node is reached through multiple paths, **the
parents' estimates silently stop being updated and the exploration rule then
prefers the wrong child, potentially forever.** Two lessons transfer literally:
  1. **Separate the edge from the node.** KataGo's fix is to track edge visit
     counts N(n,a) distinctly from node values and recompute the parent as a
     function of its edges. Our analogue: a memoised `BankResult` may be shared,
     but the *citation* that consumed it must be per-edge, or the invalidation
     graph will have exactly KataGo's shape — a refined value that no consumer
     learns about.
  2. This is Zilberstein's tree-vs-DAG condition arriving from a completely
     different literature. Two independent fields say: **sharing sub-results
     breaks compositional accounting unless the edges are first-class.** That
     convergence is worth a law in `01-PREMISE-LATTICE.md`, not a footnote.

**C15. Texel's abandoned filter is a warning about our admission gates.** The
filter that excluded "positions where quiescence deviates from search" looked
principled and cost ~39 Elo, because it removed exactly the positions the
function must handle in real play. LOBSTER has several structurally identical
filters — `sliderCandidateCap`, the `keepQuiet` closure, the tier band, the
staging-safety exclusion — each of which removes a class of situation from the
priced set on a plausible-sounding rationale. **The measurement discipline this
implies: for every admission filter, measure the fitted model's error on the
positions the filter removes, not only on the ones it keeps.** We have never done
that for any of them, and the VALUE lens's own finding (the queen's 94% discard)
says the largest such filter sits on the unit that decides the game.

### COVERS A CASE WE MISSED

**M11. Paired seats and pentanomial scoring — the direct answer to ruling 49.**
The owner's concern is that bot-vs-bot results are distorted by a
lineage-homogeneous, low-density population. Fishtest's answer to the identical
problem is not more games; it is **structure in the pairing**: every start
position played twice with seats swapped, the *pair* scored on five points, and
GSPRT with pre-registered bounds. And the payoff we do not have at all: *the gap
between the pentanomial and trinomial estimates is itself an estimate of the
population's bias.* For LOBSTER that reads: run each scenario seed with the arms
in swapped seats, score the pair, and report the pentanomial-vs-trinomial gap as
a standing **distortion column** in the mechanism report. That column is a direct
empirical handle on the thing ruling 49 says we cannot currently see.

  It also bears on a known LOBSTER defect: "an arm's config merged into every
  seat" and "did both arms play the manifest's bot" (composition B0). Paired
  seat-swapped runs make seat asymmetry *visible in the score* rather than
  silently absorbed.

**M12. Playout cap randomization: the data a search generates is not the data you
want to learn from.** KataGo runs most self-play moves at a *small* playout cap
and only a fraction at the full cap, because the value target wants many cheap
positions while the policy target wants few expensive ones — the two targets have
different optimal sampling densities and a single cap serves neither. LOBSTER's
mining pipeline has the same structure (the mechanism report serves several
questions from one game population, and the depth-idle incident was precisely a
miner reading the wrong population). The import: **the experiment spec should be
able to declare a per-target sampling policy**, rather than every column being a
by-product of whatever the play policy happened to do.

**M13. The auxiliary-target heuristic generalises past learning.** "Predicting
subcomponents of desired targets" is stated by KataGo as a *meta-learning*
heuristic, but it applies equally to a hand-built evaluator's *instrumentation*:
each game should yield one observation **per unit-flow**, not one observation per
game. On 144 games with 6 units × 3 flows that is a ~2,600× increase in
observations for the same play cost, and it is the single cheapest response to
"the config space is explored at low density". The VALUE lens's mining scripts
already compute per-unit flows offline; promoting them to a standing per-game
telemetry column is the build item.

---

## 4.4 Verdicts the lens agents can act on

- **VALUE:** you have independently rebuilt KataGo's ownership head; say so, and
  take its *second* argument — the decomposition's real payoff is credit
  assignment from few samples, which is precisely the answer to ruling 49's
  low-density worry. Promote per-unit flows from an offline mining script to a
  standing telemetry column so each game yields N observations, not one. And
  check C13: `(K/W)(1−p)` is a whole-board coefficient, which may make the
  correct fold *un-incrementalisable* — that is a direct conflict with the time
  lens's citation-scoped invalidation and nobody owns it.
- **TIME:** ask the NNUE question about the fold before building
  `feature/commit-scope`: what fraction of evaluation terms change when exactly
  one unit's action is determined? If the answer is "most of them", the 343 ms
  recovery does not follow from citation scoping alone and the basis needs a
  bucketing structure (NNUE's refresh table is the pattern).
- **COMPOSITION:** KataGo's graph-search hazard is a second, independent
  statement of the DAG problem. Add the law: *a shared value may be memoised, but
  the citation that consumes it must be per-edge* — otherwise a refined value
  reaches no consumer, which is exactly the failure that made "the layer refused"
  indistinguishable from "the layer was never asked".
- **MEASUREMENT (all lenses):** adopt paired seat-swapped scenarios with
  pentanomial scoring, and report the pentanomial-vs-trinomial gap as a standing
  distortion estimate. This is the closest thing the survey found to an
  instrument for ruling 49's concern.
- **ALL:** for every admission filter, measure error on what it removes. Texel
  paid ~39 Elo for the principled-looking filter he did not measure that way.
