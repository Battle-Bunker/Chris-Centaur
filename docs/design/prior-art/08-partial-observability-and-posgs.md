# PRIOR ART 8 — partial observability, POMDPs and one-sided POSGs vs the fog programme

Domain: the literature that has already solved the exact game the belief lens's
steps 5–8 are heading into — *a zero-sum stochastic game where one side has
imperfect information about the other's units*. It is not a POMDP; it is a
**one-sided partially observable stochastic game (POSG)**, and it has a
well-developed algorithmic theory by, as it happens, the same research group as
the simultaneous-move survey in domain 1.

Read against `04-SYNTHESIS.md` §2Q3 (ObservationRecord, the conditioning ladder),
§3 (reducibility of held width), and build steps 5–8.

---

## 8.1 Load-bearing sources

**S21. Horák & Bošanský, "Dynamic programming for one-sided partially observable
pursuit-evasion games" (arXiv:1606.06271), and Horák, Bošanský, Kovařík &
Kiekintveld, "Solving zero-sum one-sided partially observable stochastic games"
(arXiv:2010.11243).** The full treatment: value-function structure, convergence,
HSVI adapted to one-sided POSGs, and strategy extraction from approximate value
functions. Domains evaluated: **pursuit-evasion, patrolling, and search games** —
which is what invisibility potions turn our board into.

**S22. Horák, Bošanský, Kiekintveld & Kamhoua, "Compact representation of value
function in partially observable stochastic games" (arXiv:1903.05511).** The
scalability answer: project high-dimensional beliefs onto **characteristic
vectors of much lower dimension, e.g. marginal probabilities**.

**S23. Ye, Somani, Hsu & Lee, "DESPOT: online POMDP planning with
regularization", *JAIR* 58 (2017), arXiv:1609.03250.** The K-scenario
determinized belief tree, its **regret bound**, and its anytime search.

Plus the standard cautionary result on **QMDP** (Littman/Cassandra/Kaelbling's
approximation): estimating action values as if the latent state becomes perfectly
observable from the next step onwards.

---

## 8.2 What the experts decided, and their stated rationale

### (a) One-sided is the tractable subclass, and it is our subclass

General POSGs are computationally intractable; S21's whole programme is the
**one-sided** restriction — "only one agent has imperfect information while their
opponent has full knowledge of the current situation." Under invisibility
potions with truthful item boards, our situation is *approximately* one-sided per
hidden unit: the concealing side knows everything; the observing side does not.
S21's stated structural result for the pursuit-evasion case is the load-bearing
one: the value functions "depend only on position of the pursuer and the belief
he has about the current position of the evader", and "these functions are
piecewise linear and convex in the belief space."

**PWLC in belief space** is the α-vector structure: the value at a belief is a
`max` over a finite set of linear functionals, each of which corresponds to a
*plan*. The optimal object is therefore natively a **set of plans**, and
evaluating a belief means selecting among them.

### (b) The scalability fix is marginalisation — and it is explicitly an
abstraction

S22 states the problem plainly: "the dimension of this belief space is the number
of states… for many practical problems, for example in security, there are
exponentially many possible states." Their answer is an **abstraction technique**
that projects the belief onto characteristic vectors of much lower dimension,
"e.g., marginal probabilities", with a reported dramatic scalability increase.
The word *abstraction* is theirs and is doing work: marginals are a lossy
projection, and the algorithm is built to be sound *given* the projection, not to
pretend the projection is free.

### (c) DESPOT: sample K scenarios, and carry the regret bound

DESPOT builds a belief tree that "captures the execution of all policies under a
set of randomly sampled scenarios, containing all action branches but only the
observation branches encountered under the sampled scenarios", using a
deterministic simulative model. The result that makes it a design principle
rather than a heuristic: the best policy obtained from a DESPOT is near-optimal
with a **regret bound that depends on the representation size of the optimal
policy** — and the search is **anytime**, optimising a *regularized* objective
(the regulariser penalises policy size, which is what makes the bound bite).

Note the shape: *all* action branches, only the *sampled* observation branches.
The restriction is on the observation side, deliberately, and it is bounded.

### (d) QMDP's named failure: it never gathers information

QMDP estimates action values "as if the latent state will be perfectly observable
from the next time step onwards." The consequence, which is the reason every
POMDP text teaches it: it "effectively ignores the need for, and potential value
of, future information gathering", so the agent has **no motivation to act to
reduce its own uncertainty**. The canonical symptom is a robot whose Q-values
balance out, which then stays put rather than moving to see.

---

## 8.3 Mapping onto our joint

### AGREES

- **Clouds-as-marginals is the field's scalability answer**, named and measured
  (S22). The belief lens arrived at it independently and it is right. See C26 for
  the price the field is explicit about and we are not.
- **The ObservationRecord's (facts, mask, events) shape is the public/private
  factorisation** that makes these games tractable: what both sides see, versus
  what one side sees. Designing the wire around observations rather than states
  is exactly the modelling move S21's tractability rests on.
- **"Today's game is the degenerate total-mask case; code written against the
  observation record runs unchanged on it"** matches the standard practice of
  treating full observability as the limit of the observation model, and it is
  what makes steps 5–6 byte-identical.

### CONTRADICTS — flag loudest

**C25. Our design has QMDP's pathology: no action is ever valued for what it
reveals.** In the current carve, information enters the economy (contingencies →
spending; the reducibility tag gates *removal levers*; hedged preparation buys
*reaction latency*) but never enters the **action value**. There is no term
anywhere that says *this move is worth playing because it would collapse a
cloud*. The belief lens is careful and correct that the reducibility tag "never
answers what may be bought AGAINST this width" — but it also never establishes
who answers "what is this width worth removing, in units the comparator
understands?"

  Consequence, in gameplay terms and stated as a prediction: **under invisibility
  potions the bot will never spend a move to scout.** It will hold, hedge and
  pre-compute, and it will do that even when walking three cells to break line of
  sight would settle the question outright. That is QMDP's robot standing still,
  arrived at by a different route.

  The fix is not a new heuristic; it is a *type*. Value of information is
  `E[value under the post-observation belief] − value under the current belief`,
  and it belongs in the ACTION ordering as a flow like any other — the VALUE
  lens's currency can carry it (an observation changes `p` and the reachable
  transfer set), and the belief lens's (S, w) can supply the two beliefs. What is
  missing is anyone owning the seam. Today VOI sits half in ECONOMY (spending)
  and half nowhere, which is exactly the "two channels for one joint" disease.

  **Related and worse:** domain 3's C12 is the *dual* of this. Γ-maximin's
  optimal set does not shrink as beliefs sharpen, so the reduction cannot express
  "I now know more"; and no action term rewards learning more. Two independent
  mechanisms, one symptom: **nothing in the architecture makes information
  valuable.** For a programme whose flagship feature is fog, that is the single
  most important structural gap in the survey.

**C26. Marginal clouds are sound but lossy, and the loss is exactly what the
conditioning ladder produces.** S22 is explicit that marginalisation is an
*abstraction*. For a set-valued support the arithmetic is: the per-coordinate
projection of S is exact, but **the product of the marginals is a superset of
S** — sound for floors, arbitrarily loose in general. And the correlations that
get discarded are precisely the ones C1 and C2 generate:

  - **C1 (item-vanish):** "the potion disappeared, so *some* hidden unit was
    adjacent to it." That is a **disjunctive constraint across units**. Stored as
    per-unit marginals, every unit individually "might not be the one", so **every
    marginal stays as wide as before and the inference evaporates**.
  - **C2 (sub-step non-event exclusion):** "no clash occurred at this cell, so it
    is not the case that both A and B were there" — a joint exclusion, again not
    expressible per unit.
  - Occupancy/attribution counting (C0) is the one rung that survives
    marginalisation cleanly, because it is a per-cell cardinality fact.

  So the design as written will build a conditioning ladder whose top two rungs
  are **discarded by the storage format at the moment they are computed**, and
  the symptom will be "C1 measured no cloud narrowing" — which will read as C1
  being worthless rather than as a representation bug. The remedy is the standard
  one: the `ConditioningTrace` must carry **joint constraints as constraints**
  (a small constraint store beside the marginals), and the marginals are the
  *cheap query surface*, not the state. That is a design decision, not a detail,
  and it should be made before step 7 rather than discovered by a null result.

**C27. Our observation-side restriction has no bound; DESPOT's does.** When the
fog programme has to prune the observation branching (and it will — the hidden
units' possible positions multiply), the natural move is a cap. DESPOT's whole
contribution is that the restriction is to **K sampled scenarios with all action
branches retained**, plus a **regret bound** in terms of the optimal policy's
representation size, plus a regulariser that makes the bound tight. This is R-3
(every restriction is adaptive or bounded) arriving in the observation dimension,
where our design has not yet made any commitment. Making the commitment now —
"observation branching is restricted by K scenarios, and here is the bound" — is
much cheaper than retrofitting it after a cap ships.

### COVERS A CASE WE MISSED

**M21. PWLC gives the value's *shape*, and that shape is a set of plans.** S21:
the value function over belief space is piecewise-linear and convex — a `max`
over α-vectors, each an entire conditional plan. Three things follow that we have
not said:
  1. **The natural output at a belief is a set of plans plus the belief region
     where each dominates.** That is the same object domain 3's maximality
     returns, reached from a completely different direction, and it is the object
     the Centaur direction wants (surface the live options *and the condition
     under which each is right*).
  2. **Convexity means information always has non-negative value** in the
     zero-sum one-sided setting — which is the theoretical statement of C25's
     gap, and it means VOI is not an optional refinement but a property the value
     function has whether we model it or not.
  3. Value functions over belief regions are the right shape for **caching across
     turns**: an α-vector remains valid over a whole region of beliefs, so ADVANCE
     can carry it forward without recomputation while the belief stays in the
     region. That is a far stronger cross-turn carry than the scalar bridge or
     even warm hypothesis promotion, and it is what the time lens's worldline is
     groping towards.

**M22. The one-sided restriction is a modelling choice we can make, and it buys
tractability.** Our fog is two-sided in principle (both teams can drink
invisibility potions). S21's entire tractability rests on assuming *one* side is
uninformed. Two options worth naming in the design: (a) model our own concealment
as one-sided-in-our-favour (we know our state; the belief lens's `Belief(enemy)`
step 8 already does this) and their concealment as one-sided-against-us, and
solve two one-sided games rather than one two-sided one; or (b) accept
intractability and use sampling (DESPOT). Either is defensible; drifting into (b)
without saying so is not.

**M23. Search games are a named, solved domain and our board becomes one.**
S21's evaluation domains are pursuit-evasion, patrolling and **search games**. A
board with a hidden collector and a truthful item board *is* a search game. That
means (i) there is a literature of benchmark instances to sanity-check our
cloud/conditioning machinery against, and (ii) known structural results (e.g.
optimal search strategies are typically randomised, which is domain 3's M9
arriving a third time) apply directly.

---

## 8.4 Verdicts the lens agents can act on

- **BELIEF (two decisions to make before step 7):**
  1. **Own the value of information as an ACTION-side quantity, not only an
     ECONOMY-side one.** As written the design has QMDP's failure mode: no move
     is ever worth playing for what it reveals, so the bot will not scout under
     fog. VOI = `E[value | post-observation belief] − value | current belief`, and
     both lenses already have the pieces. Nobody owns the seam.
  2. **Decide the `ConditioningTrace`'s representation now.** Per-unit marginals
     cannot hold C1's disjunctive inference or C2's joint exclusion, so those
     rungs will measure as worthless when they are merely unstorable. Carry a
     constraint store; make marginals the query surface, not the state.
- **BELIEF + COMPOSITION:** the value function over belief space is PWLC — a max
  over plans. That is the same set-valued object maximality returns (domain 3),
  and it is the Centaur output. Three literatures now point at the same type;
  REDUCTION should return a set with dominance regions, not a scalar.
- **TIME:** α-vectors are valid over belief *regions*, which is a much stronger
  cross-turn carry than a scalar bridge or a matched hypothesis — the value
  survives while the belief stays in the region. Worth costing against the
  worldline's carry design.
- **ALL:** when the observation branching has to be restricted, restrict it
  DESPOT-style (K scenarios, all action branches, a stated regret bound) rather
  than by a cap. This is R-3 in the one dimension where we have not yet committed,
  and committing now is far cheaper than retrofitting.
