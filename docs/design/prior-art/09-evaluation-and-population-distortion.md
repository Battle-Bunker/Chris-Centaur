# PRIOR ART 9 — evaluation, population distortion, and how to grow a roster

Domain: the literature that has already formalised **ruling 49's exact
complaint** — that results from a population of modest variations of one lineage,
explored at low density, are distorted in ways the aggregate metric cannot show
you — and has produced both a diagnosis and an algorithm.

This domain is aimed squarely at the owner's concern rather than at any one lens,
and it ends with a unification: the same algorithmic idea appears at three
different levels of our design.

---

## 9.1 Load-bearing sources

**S24. Balduzzi, Tuyls, Perolat & Graepel, "Re-evaluating Evaluation", NeurIPS
2018, arXiv:1806.02643.** The axioms an evaluation method should satisfy, the
proof that Elo and uniform averaging fail the first one, **Nash averaging**, and
**mElo** (multidimensional Elo) for cyclic interactions.

**S25. Lanctot et al., "A unified game-theoretic approach to multiagent
reinforcement learning" (PSRO), NeurIPS 2017**, and Bighashdel et al., *Policy
Space Response Oracles: a survey* (IJCAI 2024). PSRO = empirical game-theoretic
analysis (EGTA) + a best-response oracle: maintain a population, build the
**empirical/meta-game** payoff matrix over it, solve it for a meta-strategy, and
add a new policy that best-responds to that meta-strategy.

Cross-reference: **Fishtest's paired-opening pentanomial design** (domain 4, M11)
is the variance-reduction half of the same problem.

---

## 9.2 What the experts decided, and their stated rationale

### (a) Three axioms, and Elo fails the first

S24 defines an evaluation method as a map from evaluation data (an antisymmetric
matrix) to a real-valued function on players, and requires:

- **P1 Invariant:** *"adding redundant copies of an agent or task to the data
  should make no difference."*
- **P2 Continuous:** robust to small changes in the data.
- **P3 Interpretable:** agrees with intuition in basic cases.

And then, flatly: **"Elo and uniform averaging over tasks are examples of
evaluation methods that invariance excludes."**

The diagnosis, in their words: *"Overrepresenting particular tasks or agents
introduces biases into averages and Elo — biases that can only be detected post
hoc. Humans must therefore decide which tasks or agents to retain, to prevent
redundant agents or tasks from skewing results."* That sentence is ruling 49
written by someone else, three years earlier, about a different field.

### (b) Nash averaging, and why maxent Nash is the right weighting

Given the antisymmetric logit matrix **A**, define a two-player meta-game with
payoffs `μ₁(p,q) = pᵀAq`, `μ₂(p,q) = pᵀAᵀq`. It is symmetric and zero-sum, so its
value is zero and its equilibria are "teams that are unbeatable in expectation".
The meta-game has a **unique maximum-entropy Nash equilibrium**, and *"the maxent
Nash adapts automatically to the presence of redundant tasks and agents."*
Intuition they give: if one agent dominates, both meta-players pick it; in
rock-paper-scissors the only unbeatable-on-average team is the uniform mixture.
An agent's evaluation is then its performance *against the maxent Nash
distribution*, not against the population as it happens to be composed.

**Their headline empirical result is the cautionary tale we should quote to
ourselves:** re-evaluating Atari agents under Nash averaging, *human performance
ties with the best agents* — i.e. the widely-reported "superhuman" conclusion was
an artifact of how the evaluation population was composed, and it reverses under
an invariant metric.

### (c) mElo: the transitive and cyclic parts are different objects

S24's first contribution is **multidimensional Elo**, which handles cyclic
interactions that scalar Elo cannot represent at all: the evaluation matrix
decomposes into a transitive part (which a single rating can express) and a
cyclic part (which it cannot), and the Schur decomposition of the antisymmetric
residual exposes *latent skills and latent tasks* — the dimensions along which
agents actually differ.

### (d) PSRO: grow the population by best response to the meta-strategy

PSRO iterates: (1) hold a population of policies; (2) build the **empirical
game** — the payoff matrix of the population playing itself; (3) solve it with a
**meta-strategy solver** (Nash, uniform, or another rule); (4) train a new policy
that best-responds to that meta-strategy; (5) add it to the population, repeat.
Self-play is the special case where the meta-strategy solver returns "the latest
policy"; fictitious play is the case where it returns the uniform mixture over
history. The motivation is exactly the overfitting concern: a learner that
responds to a *single* fixed opponent overfits to it; responding to a
**mixture** does not.

---

## 9.3 Mapping onto our joint

### AGREES

- **Ruling 49 is correct and the field agrees with it in print.** The owner's
  intuition — that lineage-homogeneous, low-density populations produce numbers
  driven by the scoring rule rather than by intrinsic efficacy — is the stated
  motivation of S24. This is worth relaying plainly: it is not a hedge, it is a
  known, named, formalised failure of the metrics we are using.
- **Pre-registration and frozen constants** (the value lens's `k = 1.227` frozen
  before the rook cell; Texel's frozen `K`) are the right discipline and complement
  this domain rather than competing with it.

### CONTRADICTS — flag loudest

**C28. Every headline number the programme has produced is a
non-invariant aggregate over a redundant population.** `sharePar(territory −
material)`, elimination rates, `depthEffectRate`, the R1 ladder's ordering — all
are uniform averages over a population of "modest variations of one bot lineage"
(the owner's phrase) and over a handful of hand-chosen cells. S24's P1 says
these are exactly the aggregates that redundancy skews, and that the skew *can
only be detected post hoc*. Two consequences:

  1. **The fix is cheap and needs no new games.** We already hold a replay
     archive of arm-vs-arm outcomes. Building the empirical payoff matrix over
     the arms and computing the **maxent Nash** over it is a small script and
     turns the existing corpus into an invariant evaluation. If the maxent Nash
     puts most of its mass on one or two arms, the population *was* redundant and
     we now know by how much; if it spreads, the population was diverse and the
     uniform averages were fine. **Either answer is a direct, quantitative
     response to ruling 49**, and we currently have neither.
  2. **The Atari precedent says the conclusion can reverse, not merely widen.**
     Human-vs-agent flipped from "superhuman" to "ties". A verdict like
     "territory beats material" is exactly the shape of claim that can reverse
     under reweighting, and the value lens has *already* found one instance of a
     verdict not meaning what it says (the knight cell being a dead instrument).

**C29. If the member space is cyclic, our whole comparison apparatus is
mis-typed.** Elo, win rates and `better()`-style orderings all presuppose a
transitive ordering of members. A simultaneous-move game with contested cells is
a machine for producing rock-paper-scissors structure — and domain 1's C1 says
our reduction cannot even represent the mixed equilibria such structure requires.
Nobody has checked whether our arms cycle. **This is a two-hour check on data we
already have**: build the arm-vs-arm matrix, compute its transitive/cyclic
decomposition (mElo's Schur step), and report the cyclic fraction. If it is
non-negligible then:
  - "which bot is better" is not a well-posed question over our roster;
  - a roster should be selected as a **mixture**, not a champion — which is
    exactly what the composition lens's "a bot is a value with an address" makes
    possible and what a single `DEFAULT_BOT_CONFIG` makes impossible;
  - and the production binding-site gap (no per-game bot lookup) becomes more
    serious, because a mixture cannot be played by a process that has one bot.

**C30. Our roster grows by taste; PSRO grows it by best response, and that is the
answer to "explored at low density".** Ruling 49 says the config space is
explored at low density. The instinct that follows is "run more arms", which is
expensive and still unguided. PSRO's answer is different and better: **the next
member to build is the best response to the current roster's meta-strategy.**
That directs exploration to exactly the region where the current population is
weakest, and it comes with the EGTA framing that makes "is this member worth
keeping?" a well-posed question (does it have support in the meta-Nash?).

  For LOBSTER this reads concretely: the roster is a population; the experiment
  archive is the empirical game; the meta-strategy is the maxent Nash over arms;
  and the next arm to spec is the one that best-responds to that mixture — not
  the one whose hypothesis is most interesting. It is a *procedure* for
  populating the joint machinery, which is what ruling 49 asks the architecture
  to make natural.

### COVERS A CASE WE MISSED

**M24. "Is this member worth keeping?" gets a formal answer.** The composition
lens's reachability law says a member must be seated or deleted, and the
anti-gaming counter is "a roster bot must appear in an experiment spec or be
marked an instrument". EGTA supplies a stronger, quantitative criterion:
**a member earns its place if it has support in the meta-game's Nash
equilibrium** — i.e. if there is some opponent mixture against which it is the
right answer. That is a principled, computable version of the reachability law's
intent, it cannot be gamed by adding a bot that plays a member, and it degrades
gracefully (support can be small but non-zero).

**M25. The two halves of the measurement problem are separable and we should
build both.** Fishtest (domain 4) solves *variance* — pair the openings, swap
seats, score pentanomially, and the pentanomial-vs-trinomial gap estimates the
population bias. Nash averaging solves *composition* — reweight so redundancy
does not skew the aggregate. They are orthogonal and cheap, and together they
constitute a defensible answer to ruling 49 that does not require trusting any
single number. Neither exists today.

**M26. Latent-skill decomposition tells us what our cells actually measure.**
mElo's Schur decomposition of the antisymmetric residual "uncovers latent skills
and tasks". Applied to our cell × arm matrix, that answers a question the value
lens raised and could not settle: *what dimension does each roster cell actually
test?* The knight cell being a dead instrument (48/48 games hit the cap, `elim`
exactly 0.000) would show up as a near-zero singular value — automatically,
without anyone having to read `moveGrammar.ts:27` and notice that a jump crosses
no edge. That is a general instrument for catching dead cells before spending
blocks on them, and it subsumes the value lens's M5 (rank cells by measured
`sharePar` SD) as a special case.

---

## 9.4 The unification: the same idea at three levels

The strongest structural observation in this survey is that **one algorithm
appears three times in our design at three different scales**, and we have it at
none of them:

| level | restricted set | best-response oracle | what the gap bounds |
|---|---|---|---|
| **within a decision** (domain 1) | the actions in the priced set | a pure best response over the full action set | how much value the restriction is currently losing (DO-αβ) |
| **within a game** | the policies in the population | an RL/search response to the meta-strategy | distance to equilibrium in the full policy space (PSRO) |
| **within the roster** (domain 9) | the config members that are seated | the member that best-responds to the roster's maxent Nash | whether the roster is exploring where it is weakest |

At every level: **grow the restricted set by best response, and carry the gap
that says how wrong the restriction currently is.** At every level our design
instead uses a fixed cap, a fixed default, or taste — `sliderCandidateCap: 4`,
`DEFAULT_BOT_CONFIG`, and hand-specced arms. That is R-3 from the index,
generalised: it is not three separate findings, it is one missing pattern
instantiated three times.

And it is the cleanest statement of what ruling 49 asks for that this survey
found: *an elegant core machine that carves the design space at its joints, so a
large space of explored ideas AND BEYOND configures naturally* — the "and beyond"
is a best-response oracle, and the joint machinery is what gives it somewhere to
put its answer.

---

## 9.5 Verdicts the lens agents can act on

- **OWNER-FACING / MEASUREMENT (the two cheapest high-value items in the whole
  survey, both on data we already hold):**
  1. Build the **arm-vs-arm empirical payoff matrix** from the replay archive and
     compute the **maxent Nash**. If the mass concentrates, the population was
     redundant and we now have a number for it. Balduzzi's Atari precedent says
     conclusions can *reverse*, not merely widen.
  2. Compute the matrix's **transitive/cyclic decomposition**. If our arms cycle,
     "which bot is better" is not well posed, a roster should be a *mixture*, and
     the missing production bot-binding site becomes a blocker rather than a
     gap.
- **COMPOSITION:** the roster is a population and the archive is a meta-game.
  Two upgrades follow: a member earns its seat by having **support in the
  meta-Nash** (a stronger, ungameable version of the reachability law's intent),
  and the next member to spec is the **best response to the current meta-strategy**
  rather than the most interesting hypothesis. This is the procedural answer to
  "the config space is explored at low density".
- **VALUE:** every headline number so far is a non-invariant aggregate over a
  population S24's P1 axiom explicitly excludes. Re-report the ladder under Nash
  averaging before treating any of it as settled — and note that mElo's latent-
  skill decomposition would have flagged the dead knight cell automatically.
- **ALL:** variance and composition are separable problems with separate cheap
  fixes (paired pentanomial scoring; Nash averaging). Build both; neither exists.
