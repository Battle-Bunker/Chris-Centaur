# PRIOR ART 1 — simultaneous-move search and the joint-action blowup

Domain: what the academic literature and serious open-source implementations do
about (a) the REDUCTION over enemy actions and (b) the product space of our own
units' actions. Both are joints our carve names: composition's REDUCTION kind
("a plan's value is a function over enemy actions that something must reduce to
a comparable key") and ACTION kind ("the team's move is a product space with
contested-cell structure").

Read against `07-SYNTHESIS.md` §1.2/§2.6, `04-SYNTHESIS.md` §2Q4 (the
`(supplier, ε)` reduction), and `src/lobster/search/cluster-enum.ts` as shipped.

---

## 1.1 Load-bearing sources

**S1. Bosanský, Lisý, Lanctot, Čermák, Winands, "Algorithms for computing
strategies in two-player simultaneous move games", *Artificial Intelligence*
237:1–40 (2016).** The field's reference survey: exact backward induction with
alpha-beta pruning (BI-αβ), backward induction with double-oracle and serialized
bounds (DO-αβ), and the sampling family (SM-MCTS with UCT / Exp3 / regret
matching, and SM-OOS = online outcome-sampling MCCFR). Evaluated in BOTH the
offline (converge to equilibrium) and the online (limited time per move) regime,
over six games including Tron, Goofspiel, pursuit-evasion and random games.
PDF: `dke.maastrichtuniversity.nl/m.winands/documents/sm-journal.pdf`.

**S2. Lisý, Kovařík, Lanctot, Bosanský, "Convergence of Monte Carlo Tree Search
in Simultaneous Move Games", NIPS 26 (2013), arXiv:1310.8613** — the convergence
theorem: SM-MCTS instantiated with an ε-Hannan-consistent selection rule
converges to an approximate NE; plus the negative result that constant
exploration γ bounds you away from equilibrium by γD. Follow-up
(Kovařík & Lisý, arXiv:1804.09045) sharpens it: applying HC algorithms directly
to observed payoffs is NOT sufficient; you need averaging over JOINT actions, or
an extra property.

**S3. Ontañón, "Combinatorial Multi-armed Bandits for Real-Time Strategy Games",
*JAIR* 58:665–702 (2017), arXiv:1710.04805** — the *naïve sampling* family and
NaiveMCTS, the standard answer to a combinatorial own-action space. Evaluated to
branching factor 9.28×10²².

Secondary: Churchill & Buro, *Hierarchical Portfolio Search* (Prismata — a
commercially shipped, simultaneous-move, combinatorial-action game AI; Game AI
Pro 3 ch.30); Churchill & Buro, *Portfolio Greedy Search* (AIIDE 2013);
google-deepmind/open_spiel `game_transforms/turn_based_simultaneous_game`.

---

## 1.2 What the experts decided, and their stated rationale

### (a) The reduction over enemy actions is an LP, not a min

Backward induction in a simultaneous-move game does **not** take a min over the
opponent's pure actions at a node. It builds the payoff matrix of the stage game
and solves it as a **matrix game by linear programming**, yielding a mixed
equilibrium and the game's *value*. S1's whole exact family — BI, BI-αβ, DO-αβ —
is organised around this LP. Pure maximin (the security level over pure
strategies) is a strict lower bound on that value and is *not* the value; that
gap is the whole reason the field exists rather than reusing minimax.

Rationale stated in S1: for a state to have a well-defined value under
simultaneous moves the players must be allowed to randomise; the LP is the
smallest object that carries both the value and the strategy that achieves it.

### (b) The joint matrix is built INCREMENTALLY by best response, not capped

S1's headline exact algorithm is **DO-αβ**: at each state, instead of building
and solving the full |A₁|×|A₂| LP,

1. start a *restricted* matrix game from one arbitrary action per player;
2. solve the restricted game by LP;
3. compute, for each player, a **pure best response over the full unrestricted
   action set** to the opponent's restricted-equilibrium strategy; add those
   rows/columns; repeat.

Termination is when neither best response improves. Crucially, the algorithm
maintains the best-response utilities as **bounds on the true game value, whose
sum is the current error and converges to zero**. The serialized-αβ variant
first tries to solve the *serialized* (turn-order-imposed) games with alpha-beta;
if the two serialized values coincide, a pure equilibrium exists and the LP is
skipped entirely.

Measured: DO-αβ solves games "in less than 2% of the time required by the
standard backward induction algorithm"; on random games with branching 4 and
depth 7, BI evaluates ~1.8×10⁷ nodes in ~3.5 h while DO-αβ evaluates 2×10⁶ in
~80 min. Their own negative result is honest and directly relevant: DO *without*
serialized alpha-beta does **not** beat BI, "most likely caused by a larger
number of undominated actions that forces the double-oracle algorithm to
enumerate most of the actions in each state."

### (c) Own-team combinatorial actions: never enumerate the product

S3 models the RTS player-action (one unit-action per unit) as a **Combinatorial
Multi-Armed Bandit**: variables = units, arms = that unit's actions, macro-arms =
joint moves. The naïve-sampling family rests on the *naïve assumption*

    μ(X) ≈ Σ_i μ_i(X_i)

and is a three-policy scheme: π₀ (ε₀-greedy) chooses explore vs exploit; on
explore, π_l samples **each variable independently** from its own per-unit MAB
and the resulting macro-arm is added to a *global* MAB; on exploit, π_g selects
among macro-arms **already sampled**. The global arm set is therefore built
lazily and never contains an unvisited macro-arm.

Guarantees: cumulative regret grows *linearly* (this is intentional), while
**simple regret decays exponentially**, r_T = O(D·e^{−2d²Tp_i}). The paper is
explicit that in game search the right objective is **simple regret** at the
root, not cumulative regret, citing Tolpin & Shimony and Bubeck.

Empirics: at 10,368 macro-arms naïve sampling is only marginally ahead; at
1.0×10⁶ it is significantly ahead of LSI, MLPS and flat ε-greedy; at 9.28×10²²
the separation is unambiguous.

Prismata (S-secondary) is the shipped-product version of the same instinct:
decompose a turn into tactical *categories*, give each category a **portfolio of
scripts**, generate one partial move per script per category, and search only the
cross-product of *script outputs* (a few dozen moves), never the legal move set.
The AI reached the top quartile of the ranked human ladder and — the reason it
matters to us — was chosen because it is "robust to changes in game unit
properties," i.e. it survives balance patches without re-tuning.

### (d) OpenSpiel: simultaneity is a game transform, not an algorithm feature

OpenSpiel's mainline answer is `LoadGameAsTurnBased(game)` /
`turn_based_simultaneous_game`: an n-player simultaneous node becomes n
sequential turns inside one information set. Branching at a node drops from
Π|A_i| to Σ|A_i|; the simultaneity survives as *imperfect information* rather
than as a product space. Every turn-based algorithm in the library then applies
unchanged.

### (e) Offline strength does not predict online strength

S1's most transferable empirical result, and the one they spend §6.6 on: SM-OOS
has the best offline convergence and lowest exploitability, and is *often not the
best online player* — worst in random games and Tron without an evaluation
function — because the variance of its regret updates blows up in large games.
And: "DO-αβ with a good evaluation function often wins over the sampling
algorithms without domain-specific knowledge. This is not the case with a weaker
evaluation function." When the samplers are *also* given the evaluation function,
UCT beats DO-αβ in both domains tested, and RM beats it in Tron.

---

## 1.3 Mapping onto our joint

### AGREES (and is stronger than we knew)

- **Our `cluster-enum.ts` order-2 Möbius surrogate strictly dominates the naïve
  assumption where it applies.** S3's whole family rests on μ(X) ≈ Σ_i μ_i(X_i)
  — order-1, an *approximation*, acknowledged as such. Our φ_u + ½Σφ_uv
  reproduces CL1's seed potential *identically* with zero third-order residue,
  and cross-component φ_uv ≡ 0 is proved, not assumed. On small clusters we are
  doing exact inference where the literature does approximate sampling. This is
  a genuine local advantage and the design docs should say so; it is also the
  reason the cluster partition (not the cap) is the load-bearing idea.
- **Simple regret at the root is the right objective** — S3 states it explicitly.
  The TIME lens's economy already prices tranches by what they buy; naming the
  purchased quantity as *reduction in simple regret at the root* gives the
  allowance ledger a literature-grounded denominator, and it is the same quantity
  the metareasoning literature calls value of computation (see domain 2).
- **Portfolio-of-scripts = our members-in-collections.** Prismata's shipped
  architecture *is* ruling 49's mandate: fitted strategies enter as portfolio
  members, the search composes them, and the reason given for the architecture is
  robustness to rule/balance changes — exactly the owner's "distortionary
  results" worry. This is the strongest external endorsement of the joints
  lens's carve that exists, and it comes from a shipped commercial product, not
  a paper.
- **Reachability law has a precedent**: HPS's portfolio is a checked-in list of
  scripts; a script not in a portfolio is not searched, so there is nowhere for
  an unplayed heuristic to live. Same structural remedy, arrived at
  independently.

### CONTRADICTS — flag loudest

**C1. Our reduction is a pure-strategy min; the field's is a mixed-strategy LP.**
`cluster-enum.ts` says the enemy coupling "is not a surrogate quantity at all:
the bank computes it exactly, per proposal, at price time" — i.e. min over enemy
pure actions. The belief lens then wraps this as ε-contamination
`(1−ε)·estAdvised + ε·lo` with `lo` the maximin floor, and calls ε=1 the
"adversarial zero point" that "refuses to pick a weight". **That framing is
wrong in a simultaneous-move game.** Refusing to pick a weight does not give you
the game's value; it gives you the *pure security level*, which is strictly
below the value whenever the stage game is genuinely mixed, and — worse — it is
the value of a solution concept in which we move FIRST and the enemy sees us.
The literature's zero point is not "min over enemy actions", it is "the NE of the
stage matrix", and it is a *different object*: a distribution, not a scalar
worst case. The ε dial as specified therefore interpolates between an advisory
mean and a **mis-specified** worst case, and no setting of ε reaches the
game-theoretically correct answer.

  Concretely: on rock-paper-scissors-shaped cells (which our contested-cell
  structure manufactures — two units racing for one square is exactly a
  discoordination game), maximin over pure enemy actions says every option is
  losing, so the floor carries no ordering information at all, while the LP says
  the value is 0 with a specific mixture. This is a live suspect for the
  reported "inert weight, cause (b) no-gradient" class in the VALUE and
  COMPOSITION lenses: a term that is constant across the plans `better()`
  adjudicates is exactly what a saturated pure-maximin floor looks like.

  What this does NOT say: the sound-floor law is fine as a *floor*. The
  contradiction is with calling it the adversarial *zero point of the weight
  supplier* — quantifying over all of S and integrating under the NE mixture are
  both legitimate, and they are different rungs. The belief lens's credal-set
  type is broad enough to hold both; what is missing is a THIRD named reading
  beside `sound` and `advised` — call it the *equilibrium* reading — whose
  supplier is not a weight we picked but a fixed point of the stage game.

**C2. `sliderCandidateCap: 4` is the one thing the field never does.** Every
serious implementation restricts the action set, but restricts it *adaptively and
with a certificate*:
  - DO-αβ restricts by **best response**, and carries the value-gap bound that
    says how wrong the restriction currently is; when the gap is 0 the
    restriction is provably lossless.
  - Naïve sampling restricts by a **per-variable MAB updated on realised
    reward** — the domain of each variable narrows *because of value*, never
    before it.
  - HPS restricts by a **portfolio of scripts**, each of which is a named,
    swappable member with its own rationale.

  Our cap is a *static, value-blind, weight-blind truncation of a queen's ~71
  options to 4* applied by a comparator in which nothing scales with weight,
  with no bound on what it discarded. The VALUE lens measured the damage
  (~94% discarded, on the unit holding 80–91% of team weight); the prior art
  supplies three drop-in replacements and, more importantly, the **design law**
  the cap violates: *an admission rule must either be adaptive on value or carry
  a bound on what it removed.* That law belongs in the joints manifest as the
  ACTION kind's obligation, next to "closure is kernel".

**C3. Enumerate-then-cap is the wrong order; the field samples lazily.** Our
`maxJointsPerCluster: 512` is a ceiling on a *constructed* product. Naïve
sampling's global MAB "initially contains no arms" and only ever holds macro-arms
that were actually sampled. The difference matters under the TIME lens: an
enumerate-then-cap stage has a *step function* cost profile (a cluster is either
under the ceiling and exact, or falls off to ICM), which is exactly the shape
that cannot spend a small allowance usefully. A lazily-grown arm set is
natively anytime — it is *the* anytime shape — and it is what lets
`spend(tranche, hypothesis)` be a real primitive at cluster granularity rather
than a whole-decision one.

**C4. Our above-budget fallback is the algorithm the field measured as weakest.**
`cluster-enum.ts`'s ladder falls back to **ICM on the surrogate** — iterated
conditional modes, i.e. per-variable greedy hill climbing. That is Portfolio
Greedy Search's core loop, and the AIIDE literature's own follow-ups (Fast Random
Genetic Search; Nested-Greedy Search) exist specifically because PGS is beaten at
large sizes. The module's defence — "can therefore never be worse than the status
quo" — is true and is a *different claim* from "is a good use of the budget".
The honest statement is: the fallback rung is a known-weak member, and the
manifest should carry it as one member of an ACTION-closure collection with at
least one alternative (naïve sampling over the same surrogate is ~30 lines given
the φ decomposition already exists).

### COVERS A CASE WE MISSED

**M1. The serialization escape hatch.** BI-αβ/DO-αβ first solve the two
*serialized* games (impose an order, run alpha-beta). If the max-side and
min-side serialized values coincide, the stage game has a **pure equilibrium**
and the LP is skipped. That is a cheap, sound test for "does simultaneity
actually bite here?", and it has a direct LOBSTER reading: on most turns our
board is not contested and the joint move factorises; the serialized test tells
you *per cluster, per turn* whether you are in the easy case. We have no such
test; we pay the joint machinery unconditionally. This is a first-class
candidate for the ECONOMY joint: a free pre-check that reclassifies most
clusters as trivially solvable.

**M2. OpenSpiel's transform says the product space is a modelling choice, not a
fact.** Our joints doc lists "moves are simultaneous, so a plan's value is a
function over enemy actions" as an *irreducible fact of the game*. It is
irreducible; but the *representation* as a product space is not — the standard
move is to serialise into an information set. Worth naming in 02-JOINT-INVENTORY
so a future member can be "serialised MODEL with an info-set" rather than that
being unrepresentable.

**M3. Offline/online divergence is a measurement law we should adopt.** S1 §6.6
is a direct empirical warning to ruling 49's concern: the algorithm that
converges best offline is often not the best online player, and the reason is
*variance*, not quality. Any LOBSTER instrument that scores a member by
convergence, exploitability, or agreement-with-deep-search is measuring the
offline quantity. The mechanism report should carry the distinction.

---

## 1.4 Verdicts the lens agents can act on

- **BELIEF:** ε=1 is not the "adversarial zero point"; it is the pure security
  level, a mis-specification in a simultaneous-move game. Add a third reading to
  the (S, w) projection table — *equilibrium* — whose supplier is a fixed point
  of the stage matrix rather than a chosen weight, and let the credal-set type
  span {quantifier, measure, fixed point}. Do not ship a paranoia dial whose
  endpoint is a solution concept the game does not have.
- **COMPOSITION:** add to the ACTION joint's law an admission obligation: *every
  candidate restriction is adaptive on value or carries a bound on what it
  removed.* `sliderCandidateCap` fails both and should be typed as a member of a
  collection (best-response / per-variable-bandit / portfolio-script) rather than
  a knob. Also: HPS is the closest shipped precedent for the whole four-move
  carve — cite it.
- **TIME:** the anytime primitive wants a lazily-grown arm set, not an
  enumerate-then-cap stage; and the quantity an allowance buys should be named
  *simple-regret reduction at the root* (S3 makes the argument). Add the
  serialized-equilibrium pre-check (M1) as a free ECONOMY reclassifier.
- **VALUE:** the naïve assumption μ(X) ≈ Σ_i μ_i(X_i) is the literature's
  version of per-unit weight accounts, and our order-2 surrogate is strictly
  stronger. Say so — it is the fold's best external corroboration. But note the
  scope: their decomposition is over *actions* and ours over *weight flows*;
  they are the same shape at different indices, and the fold's k does not
  transfer to action values.
- **ALL:** offline convergence quality is not online strength (S1 §6.6). Every
  arm comparison should record which one it measured.
