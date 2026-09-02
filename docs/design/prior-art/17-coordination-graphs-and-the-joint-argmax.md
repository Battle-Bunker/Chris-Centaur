# PRIOR ART 17 — coordination graphs: the exact algorithm `cluster-enum.ts` is
missing

Domain: the multiagent-coordination literature, which has been solving *exactly*
the problem `cluster-enum.ts` solves — maximise a sum of unary and pairwise
payoffs over a team's joint action — for twenty-five years, with an algorithm
that is **exact**, whose cost is exponential in the graph's **induced width
rather than in the number of units**, and whose approximate sibling is **natively
anytime**.

This is the most directly actionable engineering finding in the survey.

---

## 17.1 Load-bearing sources

**S41. Guestrin, Koller & Parr, "Multiagent planning with factored MDPs" (NIPS
2001), and *Context-specific multiagent coordination and planning with factored
MDPs* (AAAI 2002).** **Coordination graphs** and the **variable elimination**
algorithm for the joint argmax.

**S42. Kok & Vlassis, "Collaborative multiagent reinforcement learning by payoff
propagation", *JMLR* 7:1789–1828 (2006)**, and *Using the max-plus algorithm for
multiagent decision making in coordination graphs* (RoboCup 2005). The **max-plus
/ payoff-propagation** anytime approximation, and the comparison against variable
elimination and **coordinate ascent**.

---

## 17.2 What the experts decided, and their stated rationale

### (a) The coordination graph is our surrogate, and it has a name

A coordination graph decomposes a global payoff into a sum of local terms — unary
terms per agent and pairwise terms per edge. That is precisely

    Ṽ(x) = Σ_u φ_u(x_u) + ½ Σ_{u≠v} φ_uv(x_u, x_v)

from `cluster-enum.ts`, with units as agents and contested cells as edges.

### (b) Variable elimination: the exact joint argmax without enumerating the
joint

VE, in the literature's own description: *"The algorithm eliminates the agents one
by one. Before an agent is eliminated, the agent first collects all payoff
functions related to its edges. Next, it computes a **conditional payoff
function** which returns the maximal value it is able to contribute to the system
for every action combination of its neighbors, and a **best-response function**
which returns the action corresponding to the maximizing value."* After the last
agent is eliminated, a reverse pass reads off the maximising joint action.

The consequence that matters: *"within the limits of parametric representations,
the agents will determine a jointly optimal action **without explicitly
considering every possible action in their exponentially large joint action
space**."* The cost is exponential in the **induced width** of the elimination
ordering — the graph's treewidth — not in the number of agents.

### (c) Max-plus: the anytime approximation, and its explicit motivation

Kok & Vlassis's stated reason for max-plus is the one our design is built around:
*"variable elimination results in optimal behavior for the group, but its
worst-case time complexity is exponential in the number of agents, and **it is not
appropriate for real-time systems as it requires that the complete algorithm
terminates before a solution can be reported**. In contrast, anytime algorithms
for action selection are needed for real-time decision making."*

They name the anytime family explicitly: **variable elimination (run to a
deadline), coordinate ascent, and max-plus**. Max-plus is "the decision-making
analogue of belief propagation in Bayesian networks": neighbours exchange
messages, and at every round there is a current best joint assignment.

---

## 17.3 Mapping onto our joint

### CONTRADICTS — flag loudest, with the most code behind it

**C49. `maxJointsPerCluster: 512` and the ICM fallback are both superseded by one
algorithm that the field has used since 2001.** `cluster-enum.ts` builds an exact
pairwise factor graph (its Möbius decomposition is a genuine achievement — see
domain 1) and then **throws that structure away**, exhaustively enumerating the
product when it is under 512 and falling back to threshold-pruning and then ICM
above it. The structure it discards is exactly the structure VE exploits.

  Concretely, for a component of 6 units:

  | regime | enumeration | variable elimination |
  |---|---|---|
  | 3 options each | 3⁶ = 729 → **over the 512 cap, falls back** | ~6·3^(w+1); at width 2, ≈162 |
  | 8 options each (`enumCandidateCap`) | 8⁶ = 262,144 → far over | at width 2, ≈3,072 |
  | queen, ~71 options | astronomically over | at width 1–2, thousands |

  The cap is a bound on the *wrong quantity*. The right complexity parameter is
  the **induced width of the conflict graph**, which our `ConflictIndex` already
  has the data to compute, and which on a 25×25 board with ≤6-unit components is
  very likely 1–3. **Under VE the 512 cap would essentially never bind**, the
  exact regime would cover cases that today fall off to ICM, and the
  `sliderCandidateCap` pressure (domain 1's C2) drops sharply because a slider's
  71 options cost linearly in a VE message rather than multiplicatively in a
  product.

  This should be measured before it is believed: **compute the induced width
  distribution of our conflict graphs on the replay archive.** That single number
  decides how much of this is available, it needs no new games, and it is the
  cheapest possible test of the claim.

**C50. Our above-budget fallback is the member the literature benchmarks
against, not the one it recommends.** `cluster-enum.ts` falls back to "ICM on the
surrogate" — iterated conditional modes, i.e. **coordinate ascent**, which Kok &
Vlassis name as one of the three anytime candidates and which their experiments
compare *unfavourably* against max-plus. Domain 1's C4 said the same thing from
the RTS side (ICM ≈ Portfolio Greedy Search, which the AIIDE follow-ups exist to
beat). Two literatures, same verdict, same replacement available.

  And max-plus fixes the shape problem, not only the quality: it is **natively
  anytime with a monotone incumbent at every message round**, which is exactly
  the interruptibility witness domain 2's C6 says every stage needs and which the
  enumerate-then-cap step function cannot provide.

**C51. The module's own "what is not built" reasoning rules out the wrong
thing.** `cluster-enum.ts` explicitly declines the factor-graph memo's
cross-component surrogate repair as "VACUOUS under this relation" — correctly,
because cross-component terms are identically zero. But that argument is about
*between* components; the coordination-graph literature is about *within* one,
and the module's within-component strategy is the exhaustive one. The two are not
in tension: keep the cross-component independence result (it is exact and it is
ours), and replace the within-component enumeration with VE. The module already
proved the hard half.

### COVERS A CASE WE MISSED

**M50. VE's conditional payoff function is the R-4 object, produced for free.**
"The maximal value it is able to contribute **for every action combination of its
neighbours**" is a *conditional* value — a function from neighbours' choices to
this unit's best contribution and best response. That is:
  - the **dominance region** shape from domain 8 (α-vectors) and domain 3
    (maximality), at the unit scale;
  - a ready-made **contrastive explanation** (domain 10): "this unit plays A
    *because* its neighbour plays B; had the neighbour played C, it would play D"
    — the fact/foil pair with its condition, computed as a by-product of the
    argmax rather than reconstructed afterwards;
  - and a natural **cache unit**: a conditional payoff function is reusable
    across any decision where that unit's neighbourhood is unchanged, which is a
    far better memo granularity than a whole joint plan.

  So adopting VE does not merely speed up the argmax; it makes the search emit
  the set-valued, conditioned object that three other domains independently
  demanded, at no extra cost.

**M51. The elimination order is a policy, and it is the natural home for the
weight-blindness fix.** VE's cost depends on the elimination ordering, and
choosing one is a standard heuristic problem (min-degree, min-fill). For us there
is a second, domain-specific consideration: eliminate the **cheap, low-weight
units first** so the expensive high-weight unit (the queen, holding 80–91% of
team weight) is eliminated last with the richest conditional payoff function.
That is a *policy member* with an interpretable rationale, and it is the first
place in the search where unit weight enters the *structure* of the computation
rather than only its scores — which is the balance-blindness the VALUE and
COMPOSITION lenses both flagged, addressed at a level neither considered.

**M52. Treewidth is a board-structure feature, and therefore a premise
coordinate.** Under domain 14's framing, the induced width of the current
conflict graph is exactly the kind of cheap instance feature a `Choice =
conditional` selector should read: it decides which member of
{VE-exact, max-plus, coordinate ascent} is affordable *this turn*. It is
computable before any pricing, it is a single integer, and it makes the
admission/closure choice adaptive on the instance rather than on a constant —
which is R-3 satisfied in the one place with the most code behind it.

---

## 17.4 Verdicts the lens agents can act on

- **SEARCH (highest-value engineering item in the survey):** replace exhaustive
  within-component enumeration with **variable elimination** over the existing
  pairwise surrogate. The surrogate is already a coordination graph; the module
  built it and then discarded its structure. The right complexity parameter is
  the **induced width**, not the joint-space size, and the `512` cap is a bound
  on the wrong quantity. First step is free: **measure the induced-width
  distribution of our conflict graphs on the replay archive** — one number
  decides how much of this is available.
- **SEARCH:** replace the ICM fallback with **max-plus**. Two independent
  literatures (multiagent coordination; RTS combat) name coordinate-ascent /
  greedy hill-climbing as the baseline their better algorithms beat, and max-plus
  is natively anytime with a monotone incumbent — the interruptibility witness the
  design needs and the step-function shape it lacks.
- **COMPOSITION:** {enumerate, variable elimination, max-plus, coordinate ascent}
  is an ACTION-closure member collection with a clean selection feature
  (induced width) — R-3 satisfied where it matters most, and "no joint with one
  member" satisfied for the closure slot.
- **ALL (this is the part to notice):** VE's **conditional payoff function** is
  the R-4 object — a set of options with the condition under which each is right
  — emitted as a *by-product of computing the argmax*. Domains 3, 8 and 10 each
  argued we should build that object. Domain 17 says one of the ways to compute
  the answer faster produces it for free.
