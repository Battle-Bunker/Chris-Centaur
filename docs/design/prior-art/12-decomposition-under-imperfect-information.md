# PRIOR ART 12 — decomposition under imperfect information

Domain: the one result that invalidates a hypothesis shared by **three** of our
four lens designs, at the exact moment the fog programme lands.

Read against `cluster-enum.ts`'s "cross-cluster terms are provably zero", the
COMPOSITION lens's premise-fibered values and memo namespaces, the TIME lens's
re-base and ADVANCE, and the BELIEF lens's steps 5–8.

**Summary in one sentence: our architecture is a decomposition architecture, and
decomposition is sound in perfect-information games and *provably unsound* in
imperfect-information ones — not merely inaccurate, but exploitability-increasing
— and the fog programme is what turns our game into the second kind.**

---

## 12.1 Load-bearing sources

**S30. Burch, Johanson & Bowling, "Solving imperfect information games using
decomposition", AAAI 2014, arXiv:1303.4441 (CFR-D).** The first decomposition
technique for imperfect-information games that *retains* optimality guarantees,
and the statement of why every prior one did not.

**S31. Moravčík et al., "DeepStack: expert-level artificial intelligence in
heads-up no-limit poker", *Science* (2017), arXiv:1701.01724.** **Continual
re-solving** — "a sound local strategy computation which only needs minimal
memory of how and why it acted to reach the current state" — and the
counterfactual-value gadget that makes it sound.

Related: Brown & Sandholm, *Safe and nested subgame solving for
imperfect-information games* (NeurIPS 2017), which sharpens the safety
conditions.

---

## 12.2 What the experts decided, and their stated rationale

### (a) The negative result, stated plainly

S30's abstract: *"Decomposition, i.e. independently analyzing possible subgames,
has proven to be an essential principle for effective decision-making in perfect
information games. However, in imperfect information games, decomposition has
proven to be problematic. To date, all proposed techniques for decomposition in
imperfect information games have abandoned theoretical guarantees."*

The mechanism: *"if subgame S is re-solved with a fixed trunk strategy, there is
an equilibristic solution (i.e., a best response against the fixed trunk
strategy) that player 1 can exploit, once he is allowed to adjust his strategy in
the trunk."* So a locally-optimal re-solve is not merely approximate — it opens a
hole the opponent can steer into, and existing methods "may have unbounded
error."

### (b) Why values are not memoisable under imperfect information

The DeepStack line states the reason in the form that matters to us: *"you cannot
simply replace a subtree with a heuristic or precomputed value; the
counterfactual values at a public state are **not fixed, but depend on how players
play to reach the public state** (the players' ranges)."* A value is a function of
the *history distribution*, not of the state. Two arrivals at the same board with
different ranges have different values.

### (c) The constructive fix: carry bounded counterfactual values, not ranges

DeepStack's **continual re-solving** re-solves from the current public state
every turn — the same shape as our re-base — and is *sound*. The trick is the
CFR-D gadget: *"continual re-solving does not require keeping track of the
opponent's range; the re-solving step essentially reconstructs a suitable range
using the **bounded counterfactual values**. The gadget does this by giving the
opponent the option, after being dealt a uniform random hand, of terminating the
game instead of following through, allowing them to simply earn that hand's
bound on its counterfactual value."*

So the object that must cross the decomposition boundary is **a bound on the
opponent's counterfactual value**, and the sub-solution is constrained not to
increase it. That is all. And the stated guarantee: depth-limited continual
re-solving is sound, and with a good value estimate and enough computation per
step it approximates a Nash equilibrium arbitrarily closely.

---

## 12.3 Mapping onto our joint

### The contradiction, in four places

**C36. `cluster-enum.ts`'s "cross-cluster terms are PROVABLY ZERO" is a
perfect-information theorem, and fog removes its hypothesis.** The proof, in the
module's own words: "Every term of `φ_uv` fires only where two claims meet at one
cell… Two units in different components have DISJOINT `influenceOf` sets, and a
claimed cell is in the claimant's influence set by construction. So `φ_uv ≡ 0`
across components — not approximately, identically."

  That argument is geometric and it depends on knowing **where the units are**.
  Under fog a hidden enemy's cloud spans multiple components at once, so the same
  possible occupant appears in two clusters' influence sets. The clusters stop
  being independent — not because the surrogate is wrong but because the *support*
  is shared. Worse, the coupling is exactly of the forbidden kind: what we choose
  in cluster A changes which worlds of the shared cloud remain live, hence the
  value of cluster B. **The identity `φ_uv ≡ 0` becomes false, and it becomes
  false silently**, because nothing in the module's law suite tests a case where a
  unit's position is a set.

  This is the most consequential technical finding in the survey, because
  `cluster-enum.ts` is the shipped core of the search and its exactness claim is
  load-bearing for everything above it.

**C37. Memoising values by ⟨board, premise⟩ is precisely the move the literature
forbids.** The COMPOSITION lens's evaluation identity as memo namespace and
premise-fibered values assume a value is a function of the state and the declared
premise. Under imperfect information the value is a function of the **range** —
how play arrived here — and two identical premises with different histories have
different values. Today this is safe (perfect information ⟹ the range is a point
mass). Under fog it becomes unsound, and the failure mode is the worst kind: the
cache returns a *plausible* number computed under a different arrival
distribution.

  **The fix is small and it fits our carve exactly.** The premise index is
  currently `⟨support-index, observable-index, measure-index, config-index⟩`.
  Under imperfect information it needs a **fifth coordinate — the reach/range
  coordinate**, or (better, following DeepStack) a bound on the opponent's
  counterfactual value at the fibre. Adding it makes the fibration sound where it
  is currently merely conventional, and it is exactly the kind of "a value and
  the premise it was computed under travel together" discipline the composition
  lens already argues for. **The lens has the right mechanism and is missing one
  coordinate**, and the missing coordinate only matters after step 5.

**C38. Re-base and ADVANCE are continual re-solving, and continual re-solving is
sound *only because of the gadget*.** The TIME lens's re-base recomputes from the
new public state and carries forward what survived; ADVANCE transports identity,
incumbency and attention across the turn boundary while "values never do". That
last clause is exactly right and is the design's best instinct — but the
literature says something stronger and more specific: to re-solve soundly you must
carry the **opponent's counterfactual value bounds** forward, and constrain the
new solution not to increase them. Carrying nothing is the *unsafe* variant, which
"may have unbounded error" and increases exploitability.

  So ADVANCE needs one more thing in its payload, and it is a bound rather than a
  value — which means the bounds bank already produces the right type. This is a
  case where our sound/advised split turns out to be exactly the machinery the
  fix requires.

**C39. Depth threads under fog inherit the same problem.** The belief lens's
dilemma 3 asks whether depth threads' inner min should run the root's ε. Under
imperfect information there is a prior question: a thread that fixes the strategy
above it and re-solves below is doing *naive subgame solving*, and the fixed-trunk
exploit applies. The recommendation in the dilemma (couple them) is right for the
reason given, but it does not address soundness of the decomposition itself.

### What this does NOT say

- **It does not say fog is unbuildable.** DeepStack is an existence proof that
  continual re-solving with bounded counterfactual values is sound *and* strong.
- **It does not invalidate anything today.** With full observability the range is
  a point mass, `φ_uv ≡ 0` holds, memoisation is sound, and re-base is safe. Every
  current measurement stands.
- **It does not require CFR.** The result is about decomposition, not about the
  solver. What it requires is that *something* crosses the decomposition boundary
  carrying the opponent's counterfactual value bound.

### COVERS A CASE WE MISSED

**M33. "Minimal memory of how and why it acted" is the design goal we have been
circling.** DeepStack's phrase for continual re-solving is *"a sound local
strategy computation which only needs minimal memory of how and why it acted to
reach the current state."* That is the exact statement of what the TIME lens's
worldline is trying to be, and it comes with the answer to the question the
worldline design keeps deferring — *what is the minimal thing that must be
carried?* Answer: **bounds on the opponent's counterfactual values at the public
state.** Not the search tree, not the values, not the ranges. That is a much
smaller object than the carry store, the hypothesis table or the attention map,
and it is the one with a soundness theorem attached.

**M34. The gadget is a construction we can copy without CFR.** The CFR-D gadget
gives the opponent an *option to terminate and take the bound* — which is exactly
how you force a sub-solution to respect a floor without tracking the distribution
that produced it. In LOBSTER terms: when re-solving a cluster (or a turn) under
fog, add a synthetic "the enemy declines and takes its bound" branch, so any plan
that would let the enemy do better than its bound is rejected by construction.
That is implementable inside `better()`'s existing floor discipline and needs no
new solver.

**M35. Public state is the right decomposition boundary, and we have not defined
one.** The whole imperfect-information decomposition literature is organised
around **public states** — the coarsest information both players share — because
that is where a subgame can be cut at all. The belief lens's ObservationRecord
splits facts (public) from mask (private), which is the same distinction; but the
*search* has no notion of a public-state boundary, and `cluster-partition.ts` cuts
on geometry instead. Under fog, geometry is not a legal cut. Defining the public
state explicitly — and requiring every decomposition to cut there — is the
structural precondition for any of the above being buildable.

---

## 12.4 Verdicts the lens agents can act on

- **COMPOSITION (one coordinate, large consequence):** the premise index needs a
  **fifth coordinate under imperfect information** — the reach/range, or
  equivalently a bound on the opponent's counterfactual value at the fibre.
  Without it, premise-fibered memoisation is sound today and unsound after fog
  step 5, and the failure is silent. This is the cheapest possible version of a
  serious result, and the lens's own mechanism is what makes it cheap.
- **SEARCH / `cluster-enum.ts` (the finding with the most code behind it):** the
  `φ_uv ≡ 0` cross-component identity is a **perfect-information** theorem whose
  hypothesis is "each unit is at a known cell". A hidden unit is a set spanning
  components, and the identity fails. Add a law-suite case where a subject's
  position is a cloud, *before* fog lands, so this is caught by the suite rather
  than by a strength regression.
- **TIME:** re-base is continual re-solving. Continual re-solving is sound only
  with bounded counterfactual values crossing the boundary; carrying nothing is
  the unsafe variant with unbounded error. ADVANCE's payload needs a bound, and
  the bounds bank already produces the right type. Also: DeepStack answers the
  worldline's open question — the minimal carried object is *the opponent's
  counterfactual value bounds*, which is far smaller than the carry store or the
  hypothesis table.
- **BELIEF:** define the **public state** explicitly as part of the
  ObservationRecord work, and make it the only legal decomposition boundary.
  Geometry is not a legal cut once positions are sets. Also note that dilemma 3
  (thread ε coupling) sits on top of a soundness question that has to be settled
  first.
- **OWNER-FACING:** none of this invalidates any current measurement — with full
  observability every one of these arguments holds. It changes what must be true
  *before* fog steps 5–8 are built, and it is much cheaper to design in now than
  to retrofit after a strength regression that nobody can localise.
