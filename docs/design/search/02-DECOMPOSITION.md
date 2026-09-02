# 02 — The DECOMPOSITION joint: when the board factors, and who decides

SEARCH-THEORY lens, document 2. Owns design question (3): *when is the board
factorization sound (independence) vs. a bias source, and should cluster
boundaries be a searched-over object rather than a preprocessing step?*

Short answers, argued below: **the factorization is sound today for a reason
that has nothing to do with independence**; the bias it introduces is a
*coverage* bias, not a *value* bias, and the two need different instruments;
and **yes, boundaries should be searched — and the code already searches them,
in exactly one place, at depth, where it is least useful.**

---

## 1. What the partition is, named correctly

`cluster-partition.ts` computes the connected components of the interaction
graph `influenceOf(u) ∩ influenceOf(v) ≠ ∅` over the non-slider units we
command, then augments **every** component with **every** live slider we
command.

Two literature names, both of which the file's own comments have already found
without citing:

- The object is a **coordination graph** (Guestrin, Koller & Parr, 2002).
- The slider fiat is **cutset conditioning** (Pearl, 1986). The measured
  justification is in the file: components are ≤3 on 98.9% of 563,557 team-turns
  and 88.7% are singletons, but the `n=6-with-slider` stratum is rescued
  16.1% → 96.5%, *because the interaction graph is a star whose hub is a slider
  89.7% of the time*. Lifting a hub out of the residual graph and conditioning
  on it is the textbook operation for exactly that shape.

Naming them buys something concrete: it tells us which failure modes to look
for. Cutset conditioning is exact when the cutset is a true separator and
approximate when it is not; and a coordination graph is exact for the *value*
only if the value decomposes over its cliques.

## 2. Law D1 — the decomposition may restrict the proposal operator and nothing else

> **A decomposition of the board may be used to GENERATE candidate joint
> actions. It may never be used to compute, bound, order or compare a value.
> Every proposal is priced by the unconditional whole-board bank and adjudicated
> by `better()`.**

This is the single most important thing our architecture already gets right, and
it is currently an accident of how the code was written rather than a stated
rule. `cluster-partition.ts` says the operative half —

> *"A partition is a way of GENERATING proposals. It writes no ledger entry,
> returns no candidate set, and touches no bound."*

— and `core.ts::offerClusterJoints` says the other half. But nothing forbids a
future member from reading `cluster.score(plan)` as a value, and the surrogate
gate already reads it as an *ordering*, which is one small step away.

**Why the law is necessary here specifically.** Our payoff is one whole-board
`resolve` followed by one `evaluate`. A mid-turn collision couples the entire
board: two units in different components can kill each other, and a slider's ray
crosses arbitrarily many components. So `u(a) ≠ Σ_c u_c(a_c)` in general, and
the error is not small — it is the difference between a unit living and dying.
The literature has measured where such factorizations fail: Castellini,
Oliehoek, Savani & Whiteson (arXiv:1902.07497, *Analysing factorizations of
action-value networks*) show that low-order factorizations lose exactly on
games with **tight coordination requirements** and **sparse value structure** —
which is a precise description of a board where the whole difference between two
joint plans is whether two of our units enter the same cell.

So the value-decomposition line (VDN / QMIX / Deep Coordination Graphs) is not
merely unattractive here; it is unsound for our payoff. The generator line has
no soundness obligation at all. **Law D1 is what keeps us on the right side of
that, and it is free.**

### 2a. The corollary the law implies and we do not enforce

If the decomposition only generates, then **the only thing that can go wrong is
that some good joint action is never proposed**. That is a *coverage* obligation
and it wants a coverage instrument, not a soundness one. We have neither.

> **Finding D-1.** There is no measurement anywhere of *what the enumeration
> could not propose*. `ClusterStats` records `rungThreshold` / `rungIcm` /
> `rungRation` / `cells` / `worstClusterCells` — how often we fell off the exact
> rung — but nothing records whether the plan the search finally staged was
> reachable from the proposal set. The cheap version: on each decision, report
> `planDistance(staged, nearestProposal)` in units. A staged plan at Hamming
> distance 4 from every proposal is a decision the enumeration contributed
> nothing to; a distribution of those distances is the coverage curve, and it
> costs one loop over ≤32 proposals.

### 2b. Law D2 — the cut must be PUBLIC, and Law D1 is why the theorem does not already bite us

Added after the prior-art lens's R-5, which supplies the one thing Law D1 was
missing. This is the most consequential amendment in this document.

**The theorem.** Burch, Johanson & Bowling (AAAI 2014, *Solving imperfect
information games using decomposition*) established that under imperfect
information, a subgame re-solved in isolation **abandons the guarantees the
decomposition was supposed to provide**: the re-solved strategy opens a hole
that an opponent can *steer into*, and the resulting exploitability is
**unbounded**. Every decomposition technique that worked under perfect
information had to be rebuilt. The fix is structural: **a decomposition may only
cut at PUBLIC STATES** — the coarsest information shared by all players — and a
re-solve must additionally be constrained by the opponent's value at the cut
(the CFR-D gadget).

**Our cut is geometric, which is a public predicate only under full
observability.** `influenceOf(u) ∩ influenceOf(v) ≠ ∅` is a statement about
where units are. Today every unit's position is a fact both players know, so the
predicate is public and the cut is legal. Under fog it is a statement about our
*cloud* for a hidden unit — our belief, not a shared fact — and two players
would compute two different partitions from the same board. That is not a legal
cut.

> **Law D2, first formulation (SUPERSEDED — see §2b′).** *A decomposition's
> boundary must be measurable with respect to the coarsest information shared by
> all players.* This is the shape the imperfect-information literature gives the
> rule, and it is over-strong for us. §2b′ replaces it with a constructive
> version that needs no separate fog clause.

**Finding D-5, first formulation (SUPERSEDED by D-5′ in §2b′).**
`cluster-enum.ts` argues that cross-cluster terms are *provably zero*. That
proof assumes each unit occupies a **known cell**. Under fog a hidden enemy's
cloud spans components, so the same possible occupant appears in two clusters'
influence sets and the identity **goes false silently** — no exception, no
counter, no refusal. And the law suite that would catch it cannot: no subject in
it has a **set-valued position**.

The prophylactic is cheap and should be specified now rather than after fog
lands: **add a law-suite subject whose position is a set.** Then the identity
breaks inside the suite, localised, on the day someone changes the observation
model — instead of surfacing later as an unlocalisable regression in a system
where six other things also changed.

**Why this does not invalidate anything measured so far, stated plainly.** Full
observability is the point-mass case of a range, so every number this program has
taken stands. And fog remains buildable — DeepStack is the existence proof that
sound decomposition under imperfect information exists. What changes is the
*order of work*: the law clause has to exist before anyone builds on the
decomposition, because retrofitting a public-state cut into a geometric one is a
rewrite and adding the clause now is a paragraph.

### 2b′. Law D2, corrected: the relation is OCCUPANCY-REACH OVERLAP, and `influenceOf` already computes it

The composition lens (25-ARGUMENT-HYPOTHESES) put a hypothesis to me that
**dissolves** the two patches above into one law, and I checked it against the
construction. They are right, and the correction is a definition change rather
than a mechanism.

**What `influenceOf` actually computes** (`substrate.ts`):

```ts
influenceOf(unitId) {
  const cells = new Set<CellIndex>(unit.cells);            // the WHOLE occupancy
  for (const candidate of this.enumerate(unitId)) {
    if (candidate.action.kind !== 'move') continue;
    for (const c of candidate.action.path) cells.add(c);   // the WHOLE path
  }
  return cells;
}
```

It is the union of the unit's **entire occupancy** (a trail unit's whole body,
not its head) and **every cell every legal path enters** (the whole ray, not the
destination). And `cluster-partition`'s relation is the **intersection** of two
such sets. So the scoping is already occupancy overlap, not destination
equality — the correct relation, at full observability, by the composition
lens's own argument: two units interact when their occupancy-reach sets meet,
and a trail unit occupies many cells.

> **Law D2′ (the constructive form).** The interaction relation is the
> intersection of **occupancy-reach sets**, where a unit's occupancy is its
> **cloud** when its position is uncertain and its **cells** when it is not.
> Full observability is the point-mass case. There is no separate fog clause.

**Finding D-5′ (replacing D-5, and sharper).** The gap is not that positions
become set-valued in the abstract. It is that **`influenceOf` computes reach
from a POINT — the last-seen record cell — and enumerates the grammar from
there.** For a unit with `staleness > 0` the true occupancy is the dilated
cloud, and reach-from-cloud strictly contains reach-from-last-seen. So:

- **at ply 1 today**, `staleness = 0` for every unit and the two coincide
  exactly, which is why nothing is wrong now;
- **at ply ≥ 2** the door manufactures staleness (`staleness = rootTurn −
  record.heldAtTurn`), and under fog it arrives directly;
- and the divergence is **in the unsound direction**: point-reach
  **under**-approximates, which **misses pair terms**, which is exactly how
  `cluster-enum`'s cross-cluster-zero identity goes false.

**And the fix degrades in the safe direction, which is the direction the
function's own doctrine already prefers.** `influenceOf`'s comment reads: *"a
footprint that is too big makes a tier-2 cache transfer fail to apply (work
repeated, never a wrong answer), and makes a dirty-set re-search too eager (time
spent, never a stale bound kept). A footprint too SMALL would silently keep an
invalidated evaluation."* Cloud-based occupancy is the too-big direction. It
merges components, costing **arity**, never correctness.

**This retracts the strong reading of my own D2.** A belief-derived cut does not
need to be *public* to be sound, because under Law D1 the partition only
generates: a coarser partition is always a sound generator, so a cut computed
from our own beliefs costs cluster size and nothing else. What must hold is that
the relation **over-approximates consistently** — which is precisely what
occupancy = cloud gives. Two patches (a public-state clause and a set-valued
law-suite case) become **one law with one enforcement**, as the composition lens
predicted.

**The S2½ case, respecified with its own falsifier** (their ordering rule
requires it: *an assertion that never fires is indistinguishable from an
unviolable hypothesis*):

> A law-suite subject with `staleness > 0` whose **cloud spans two components**
> while its **last-seen cell does not**. Assert the partition **merges** them.
> The falsifier is built in: the case must **FAIL against today's point-based
> `influenceOf`** — proving the assertion can fire — and **pass** against the
> cloud-based one. A case that passes both ways is testing nothing, and should
> be deleted rather than kept as reassurance.

#### 2b.1 Law D1 is exactly what makes the theorem non-binding today — a stronger argument than the one I first gave

I originally justified Law D1 by the additive-decomposition failure
(`u(a) ≠ Σ_c u_c(a_c)`). R-5 supplies a better justification, and it is worth
stating because it upgrades the law from prudent to load-bearing:

> Burch et al.'s unbounded exploitability comes from **re-solving a subgame for
> its value**. Under Law D1 we never do: cluster results are proposals, every one
> is priced by the unconditional whole-board bank, and `better()` adjudicates on
> the proved floor. **So the theorem's hypothesis is not satisfied, and its
> conclusion does not apply to our floors.** Law D1 is the property that buys
> that exemption.

That is a strong position and it should be defended, because there are exactly
three places where the decomposition today does more than generate, and each is
a small step toward satisfying the theorem's hypothesis:

1. **the surrogate gate** — `offerClusterJoints`'s `requireSurrogateGain` skips a
   proposal that does not beat the incumbent on `cluster.score`. That is the
   decomposition **filtering** the priced set;
2. **the offer order** — `offerOrder` weights the dispatch permutation by
   `score(p) − score(map)`, so the decomposition **orders** what gets priced
   first under a clock that may not reach the rest;
3. **Door C's refine scope** — `setRefineScope(sub, { members })` lets the
   cluster membership decide **where evaluation budget may be spent**.

None of the three touches a bound, so none violates D1's letter. All three make
the *set of plans actually priced* a function of the decomposition. Under full
observability that costs coverage. Under fog, where the cut itself is not
information-consistent, it becomes something worse:

> **Finding D-6 (a conjecture with a named mechanism, not a theorem).** Under
> partial information, a coverage failure is not merely a missed opportunity —
> it is a **steerable** hole. Our proposal generator's blind region is a function
> of our clouds; the opponent's actions determine where our clouds are wrong;
> so an opponent who models our generator can drive play toward the region it
> cannot propose in. Burch et al.'s theorem is about re-solving and does not
> prove this; the mechanism is the same one, applied to generation rather than
> valuation, and it is the reason Law D2 should govern the *generator's* cut and
> not only a hypothetical value decomposition.

#### 2b.2 The problem is already live at depth, today, and one existing rule is what contains it

This is not only a fog-programme concern, and I think this is the sharpest
consequence of R-5 for the code as it stands.

`scout/door.ts` builds shell 2 with `staleness = max(0, rootTurn −
record.heldAtTurn)`, so **at ply ≥ 2 held units carry dilated clouds** — a
partial-information state, reached by simulation rather than by fog. And
`scout/scout.ts::deepen` calls `expandCluster(...)` at those roots, redrawing
cluster boundaries over cloud-derived geometry.

> **Finding D-7.** The imperfect-information decomposition problem is live in the
> depth layer **today**, under full observability, because the door manufactures
> partial information as a side effect of looking ahead. Cluster boundaries are
> redrawn at ply ≥ 2 on a non-public cut.

And the thing that contains it is a rule written for a different reason:

> *"under Door A a thread ceiling reaches exactly two things: `estSpread` (a
> discrimination number) and the scheduler's priors. It reaches no bound, no
> `lo`, no `hi`, and no staged plan, because nothing in `scout/` may write one
> (see `scout/index.ts`'s import law and its structural test). So the exposure is
> a mis-ordered candidate, never a wrong staging. That asymmetry is the entire
> reason Door A was the door that shipped."*

The scout's import law is Law D1 applied to depth, enforced structurally, and it
is the reason the deep layer's non-public cut costs an ordering rather than a
bound. **The design's most defensive choice turns out to be load-bearing for a
reason its authors did not name.** Which is also the argument against ever
relaxing it: any future door that lets a thread write a floor would satisfy
Burch et al.'s hypothesis exactly.

#### 2b.3 The CFR-D gadget is a synthetic witness — no solver required

The prior-art lens's M34 observes that the CFR-D re-solving gadget is copyable
without CFR: a synthetic *"decline and take your bound"* opponent branch,
rejecting any plan that lets the enemy beat its bound. I want to add where it
lands in our machinery, because the fit is exact and it is one line of vocabulary
rather than a new subsystem.

In CFR-D the opponent at a subgame root chooses between **entering** the subgame
and **declining** — taking their counterfactual value from the trunk. Requiring
our strategy to beat the declined value is what bounds the re-solve's
exploitability.

We already have the object that expresses "a reply the opponent could make, whose
value is a certificate against every plan": **a witness.** And we already have
the rule that rejects a plan a reply holds below the incumbent's proved floor:
`refutedAt`. So:

> **The gadget is a witness constructor.** For each held unit (or each cloud),
> synthesise the reply that realises the opponent's bound, bank it as a column,
> and the existing floor discipline does the rest. No solver, no new comparator,
> no new soundness argument — it rides `bank.ts`'s B2 rung and doc 06's column
> set unchanged.

That also means the cost is already understood: a synthetic column costs exactly
what a real one costs (Finding W-1), and it is exactly the kind of column that
support-based pruning would keep, since a bound-realising reply is rarely
dominated.

## 3. Where the factorization DOES introduce bias, and it is not where you'd guess

Three distinct bias sources, only one of which is about independence.

**(i) Composition bias — the real one.** Per component we keep `k` best joints
with a Hamming diversity floor; across components we compose **best-first**
(`composeBestFirst`). The composed list is therefore a greedy front over a
product of k-best lists. Any joint action requiring the *second*-best assignment
in three different components simultaneously is not in the list unless the
frontier reaches it. That is a coverage bias and it is exactly the failure the
rejected `cluster-seed.ts` exhibited in a worse form (*"a committed greedy argmax
that builds ONE joint assignment, unit by unit, each choice constraining the
rest"*). The k-best + Hamming floor is a real mitigation; `composeBestFirst` is
where it partially undoes itself.

**(ii) Surrogate bias, which is *smaller* than the literature's standard.**
`surrogateScore` is `Σᵢ unary(i) + ½ Σᵢ≠ⱼ pair(i,j)` — an **order-2 Möbius /
pairwise-factor model** — and `enumerateExact` solves it by **exact enumeration**
over the Cartesian product (≤512 leaves at `k_c ≤ 3`, `|D| ≤ 8`). The file's own
justification for not building a junction tree is sound at that size.

> **Endorsement (prior-art lens's, which I confirm from the code and want on the
> record).** This is *strictly stronger* than what the combinatorial-bandit
> family does. NaiveMCTS and the CMAB line for RTS games sample under the
> **naive additive assumption** — order-1, `Q(a) ≈ Σᵢ Qᵢ(aᵢ)` — and rely on
> sampling to recover interactions. We carry the order-2 interaction term
> explicitly and do **exact** inference over it. Our surrogate's error is
> third-order-and-above interaction; theirs is second-order-and-above plus
> sampling noise. Where a joint's members are drawn from that literature, ours
> should be listed as the strongest, not as the odd one out.

The honest caveat: a mid-turn three-way collision *is* a third-order term, and
`PAIR_SHARE = 0.5` (each ordered pair counted once) is exactly right for
pairwise casualties and silently wrong for a three-body clash. That is a named,
bounded error, which is more than the alternatives can say.

**(iii) Independence bias — the one that mostly does not bite.** The residual
graph's components genuinely do not interact *through the influence relation*.
They can still interact through the board (a food pellet two components both
want; a corridor both need). But because of Law D1 that interaction is priced
by the bank on every proposal, so it costs *proposal quality*, not correctness.
The 88.7%-singleton statistic says most components are one unit anyway, at which
point the "decomposition" is doing nothing but ordering.

> **Finding D-2.** On 88.7% of team-turns the composed joint IS the per-unit
> surrogate argmax, and `offerClusterJoints`'s own `minHamming` filter then
> discards it as within one unit of the incumbent — the code says so and quotes
> the measurement (*"scattered boards … spent their whole 32-question budget on
> 77 proposals and finished a mean 0.769 BELOW the arm without them"*). So on
> the overwhelmingly common board, the enumeration's entire contribution is
> filtered out by design, and the layer is paying its setup cost (measured at
> 311–343 ms before the ordering fix) for the 11.3% tail. **That is not an
> argument against the layer** — the tail is where the hard decisions are — but
> it is an argument that the layer's budget should be *conditional on the
> partition it found*, which today it is not: `enumDeadline` rations by turn
> fraction, never by whether the partition is trivial.

## 4. Should boundaries be searched? Yes — and we already do it, in the wrong place

### 4a. We have the mechanism

`scout/scout.ts::deepen` calls `priceExpansion(...)` and, when admitted,
`expandCluster(partition, clusterId, unitId, maxVariables)`, adding a unit to
the cluster mid-thread, monotonically (added, never dropped), with the prefix
already published so no stored suffix is patched. **That is boundary search: an
online, value-priced decision to redraw a cluster.**

It runs only inside a depth thread, on a continuation root, where its effect
reaches `estSpread` and the scheduler's priors and *nothing else* (the scout's
import law forbids it from writing a bound). At ply 1 — where the staged plan
actually comes from — the partition is computed once in `openCluster`, memoised
by `clusterReady`, and never revisited for the life of the session.

> **Finding D-3.** The partition is a *preprocessing step at ply 1 and a
> searched object at ply ≥ 2*, which is exactly backwards relative to where each
> costs and buys. At ply 1 the partition determines every proposal the decision
> will ever see and the budget is a whole turn; at ply ≥ 2 it determines an
> advisory ordering nudge and the budget is a tithe.

### 4b. What the literature says boundary search should look like

The closest live literature is not coordination graphs — it is **anytime
multi-agent path finding by large neighborhood search**, which is our own-team
problem almost exactly: collision-free plans for a set of agents, optimised
anytime by repeatedly *destroying* a subset of agents' plans and *repairing*
them. The neighborhood **is** the cluster, chosen per iteration.

| result | what it says | what it means here |
|---|---|---|
| Choudhury, Gupta, Morales & Kochenderfer, AAMAS 2021 (arXiv:2101.04788, `FactoredValueMCTS.jl`) | MCTS + coordination graphs + iterative max-plus, with **dynamic, state-dependent** coordination graphs, scales to problems intractable for flat MCTS | state-dependent CGs are a shipped, published design; ours being per-decision-static is a choice, not a necessity |
| Phan, Huang, Dilkina & Koenig, 2023 (BALANCE, arXiv:2312.16767) | a **bi-level multi-armed bandit** adapts *which destroy heuristic* and *what neighborhood size* online during the search; Thompson sampling best; ≥50% cost improvement at scale. Fixed neighborhood size + greedy adaptive selection is named as the bottleneck | the two dials are (heuristic, size) and they should be *learned within the decision*, not configured |
| Phan, Zhang, Chan & Koenig, 2024 (ADDRESS, arXiv:2408.02960) | restricted Thompson sampling over the **top-K most delayed agents** as the neighborhood seed; ≥50% cost improvement with a *single* destroy heuristic | seed the neighborhood from the units contributing most to the deficit, not uniformly |
| Chan et al., 2024 (DROP-LNS, arXiv:2402.01961) | run multiple destroy/repair operations **in parallel** | we already have a worker pool and a `speculate` seam |
| Tan, Luo, Li & Ma, SoCS 2025 (arXiv:2407.09451) | unified re-evaluation: **rule-based destroy heuristics are strong baselines; learned neighborhood selection shows no clear advantage** on time or improvement capacity | Ruling 49 discipline: do not reach for a learned selector. The named opportunities — target high-deficit agents, contextual selection, tune replan order and neighborhood size — are all rule-based |

That last row matters for how this program should spend. The field ran the
learned-vs-rule-based experiment at scale and the rule-based baselines held. So
the boundary-search member list should be **rule-based heuristics plus a bandit
over them**, and nothing else, until something forces otherwise.

### 4b½. Two principled members the joint was missing: variable elimination and max-plus

From the prior-art lens's domains 17–18, with their own honest self-correction
carried through.

**(i) `cluster-enum` builds a coordination graph and then throws its structure
away.** It materialises the order-2 factor tables and walks the **full Cartesian
product** (`enumerateExact`, ≤512 leaves), so its cost is exponential in the
number of **units**. **Variable elimination** computes the identical exact joint
argmax at cost exponential in the **induced width** of the graph — a quantity
that is 1 for a star, 1 for a chain, and small for most sparse graphs regardless
of how many units they contain.

Their self-correction is the important part and I am carrying it verbatim in
spirit: **there is no win on ≤3-unit components**, because at that size the
product *is* the elimination and the file's refusal to build a junction tree is
correct. What VE changes is elsewhere:

- it converts today's **ICM-fallback case** (5–6+ variables, slider boards —
  `ClusterStats.rungIcm`) from an approximation into an **exact** solve;
- it **decouples a slider's option count from component size.** Under the
  product, a queen's domain multiplies every other unit's; under elimination the
  slider is eliminated once, against its neighbours only.

That second point is the one with teeth, and it names a mechanism nothing else
in this program has: **it is the first place a unit's option count enters the
*structure* of the computation rather than only its *scores*, and therefore the
mechanism by which `sliderCandidateCap` gets RELAXED rather than re-tuned.**
Doc 03's Law P1 says a value-blind rank prefix is not an admissible restriction;
this says the reason the prefix exists (a queen's 71 options blow up the
product) is an artifact of the *algorithm*, not of the problem.

Elimination order, from the same source: **high-domain units early where their
conflict degree is low** — which is exactly a slider sitting as a star hub, the
89.7% case.

**(ii) The ICM fallback loses to max-plus in two literatures** (Kok & Vlassis on
coordination graphs; the RTS line), and max-plus has a property ICM structurally
cannot have: it is **natively anytime**, with a monotone incumbent after every
message round. That is exactly the interruptibility witness doc 07 §2 finds
missing — an enumerate-then-cap step cannot produce one, because its intermediate
state is not a plan.

So the `size`/fallback ladder gains two members and the ladder becomes a real
member list rather than a degradation sequence:

| member | exactness | cost driver | anytime? |
|---|---|---|---|
| **product enumeration** (today's exact rung) | exact | units | at leaf stride only |
| **variable elimination** | **exact** | **induced width** | no (but it terminates where the product does not) |
| **max-plus** | approximate, converges on trees | messages × edges | **yes, monotone per round** |
| **ICM** (today's fallback) | approximate | sweeps × units | weakly |
| **threshold-split** (today's other fallback) | approximate | edges kept | no |

**(iii) M50, and it is the best of the three.** VE's intermediate objects are
**conditional payoff functions**: for each eliminated unit, "if my neighbours do
*this*, my best response is *that*, worth *this much*". That object is
**exactly the set-valued output** doc 01 §8's Finding R-4 says the ADVICE
consumer needs — options *plus the conditions under which each is best* — and VE
emits it **free, as a by-product of computing the argmax it was already
computing**.

Three consequences worth stating separately:

- it is a **natural cache unit**, valid exactly while that unit's neighbourhood
  is unchanged — which is the same invalidation predicate `SweepDirty` already
  maintains;
- it is a **ready-made contrastive explanation** ("we went left because the
  queen stayed; had it advanced, right was worth 3 more"), which is the Centaur
  surface asking for a data structure and being handed one;
- and it means the set-valued arity member (doc 09 §5's one surviving
  motivation) may not need a new mechanism at all — it may be a *by-product of
  changing the exact solver*.

**(iv) The free first step, and it goes in the build order at D0.**
Measure the **induced-width distribution of the conflict graphs** on the replay
archive. One integer per decision decides how much of (i) is available: if
induced width is ≤2 almost everywhere, VE buys nothing over the product and the
ICM-fallback case is rarer than the slider census suggests; if it is small while
unit counts are large, the whole of (i) is on the table.

And that integer is a **premise coordinate**, not just a statistic: a
`Choice = conditional` selector reads it to pick `{enumerate, VE, max-plus,
ascent}` per instance — which is the composition lens's own conditional-choice
form doing real work, on a quantity the board supplies rather than a flag a
person sets.

### 4c. The joint

```ts
/** How the decision decides what to solve jointly. One per decision; the
 *  members below all produce the same TYPE, so they are interchangeable. */
interface Decomposition {
  /** The base graph. Members: interaction-components (today), interaction
   *  + slider-fiat (today, and the default), conflict-graph-from-resolution,
   *  spatial-radius, singleton (the null member = pure coordinate ascent). */
  readonly graph: (board: Board, roster: UnitId[]) => Partition

  /** WHEN it is (re)computed. Members: once-per-decision (today),
   *  once-per-slice, on-refusal, adaptive. */
  readonly schedule: RecomputeSchedule

  /** WHICH component gets the next enumeration budget, given what the ascent
   *  has found. Members: fixed-order (today, via `cursor`), most-deficit,
   *  most-refused, bandit-over-the-above. */
  readonly focus: (state: AscentState) => ClusterId

  /** HOW BIG. Members: exact-ration (today: `maxClusterCells` = 8000),
   *  fixed-k, bandit-over-sizes (BALANCE). */
  readonly size: SizePolicy

  /** HOW the exact/approximate solve is done. Members: product enumeration
   *  (today), variable elimination (exact, cost in INDUCED WIDTH), max-plus
   *  (natively anytime), ICM (today's fallback), threshold-split. Selected
   *  per instance by a `Choice = conditional` reading the induced width. */
  readonly solver: ClusterSolver
}
```

Four sub-joints. The important structural claim is that **they are genuinely
four and not one**: BALANCE's result is precisely that adapting the heuristic
alone (a single-level bandit) leaves the size bottleneck untouched, and vice
versa. Collapsing them into one "cluster policy" enum would reproduce the defect
the composition lens catalogues as `CandidateKnobs is three kinds in one bag`.

### 4d. What today's code is, as members

| sub-joint | today's member |
|---|---|
| `graph` | interaction-components + slider-fiat. **A good member and probably the right default** — the 16.1% → 96.5% rescue is real |
| `schedule` | **once-per-decision, memoised at the first refinement slice.** The null member of the schedule sub-joint |
| `focus` | **fixed order**: `cluster.cursor` walks `proposals` monotonically in the order the sampler permuted them at enumeration time, and `offerClusterJoints` never revisits. Adaptive on *nothing* |
| `size` | `maxClusterCells: 8000` — a ration set 4.5× above the worst observed cluster, so **inert on every board measured**. Beside it `maxClustersSolved: 64` against a measured 1.0–5.5 clusters per decision, also inert; and `budgetFraction: 0.35`, which is very much not inert |

Read together: three of the four sub-joints are at their null member, and the
one that is not (`graph`) is at a well-chosen one. That is a clean statement of
where the headroom is.

## 5. The cheapest boundary-search member, and why it is the one to build

**Re-enumerate one cluster around the incumbent.** Today `clusterOf` runs the
enumeration once, on the board as it was at the first refinement slice, and
every proposal the decision will ever see is conditioned on that moment. The
ascent then moves the incumbent — sometimes a long way — and nothing
re-derives the exact joint solve around where it ended up.

That operation has a name: it is **ruin-and-recreate / large neighborhood
search**, with the neighborhood being one cluster. And the machinery is already
built: `enumerateExact` takes `conditioned` domains and `conditionedPick`
precisely so a cluster can be solved *given* the rest of the plan. So the
operator is:

```
pick a cluster c            (the `focus` sub-joint)
fix every unit outside c    at the incumbent's assignment  (`conditioned`)
enumerate c exactly         (existing code, ≤512 leaves)
offer the k best            (existing `offerClusterJoints` path)
```

Cost is one cluster's exact walk — microseconds on the surrogate — against a
whole-board enumeration measured at 311–343 ms. **This is the single largest
capability-per-millisecond item this lens has found**, and it needs no new
inference machinery, no new soundness argument (Law D1 covers it: they are
proposals), and no flag beyond the `focus` member.

The `focus` member to start with, from ADDRESS: **the cluster containing the
units the current resolution names as casualties or as `contestedUnits`** — the
deficit-seeded neighborhood. That is `selfInflictedPairs` and `contestedUnits`,
both of which already exist and are already computed on the incumbent's
resolution.

> **Finding D-4.** `pairRepair` and `jointPolish` are both *fixed-size,
> fixed-shape* neighborhoods (a pair; ≤3 units × top-2) over the same signal a
> cluster re-enumeration would use. They are the `size = 2` and `size = 3`
> members of a family whose other members are free, because the exact enumerator
> already handles up to 8 variables and 8000 cells. The architecture has been
> paying for a general exact joint solver and using it once per decision at a
> fixed boundary, while hand-writing two special cases of the same operation for
> the boundaries it actually needs.

That framing also resolves a small ugliness: `jointPolish`'s `polishUnits` was
extended (under the multi-start) to union `contestedUnits` with `crowdedUnits`
*because the shipped gate is empty on a plan with no accidents*. Under the
decomposition joint that is not a special case at all — it is the `focus` member
choosing a geometric signal instead of a resolution signal, and both are members
of one list.

## 6. Contradictions and cross-lens asks

### C-J2 — `search.clusterEnum` is not a flag, and the composition lens should know why

`07-SYNTHESIS.md` finding 4 lists `search.clusterEnum` alongside
`territoryRefine`, `multistartSeed` and `sampledCap` as *"unversioned,
unrecorded members with no priors, no cost model, no record and no player"* and
R1's falsifier requires the reachability check to flag all four.

`cluster-partition.ts` says the opposite and is right:

> *"`CENTAUR_CLUSTER_ENUM` IS DELETED … The partition and the exact enumeration
> are KERNEL MACHINERY, not a candidate strategy, and they always run. The
> switch was also a silent switch on the depth layer — whose threads are rooted
> at this enumeration's own proposals — which is the dependency class that made
> one experiment race three identical contenders and file the null against the
> wrong thing."*

Both statements are true of different objects and the disagreement is real:
`cfg.search.clusterEnum` still exists as a config field (`enumDisabled` is read
in `openCluster` and produces a scout gate string), so the reachability check
*will* flag it — and the right remedy is not "seat it" but **delete the field**,
because a member that silently disables the depth layer is the very defect the
file's comment records. This is a small item and it should be resolved
explicitly rather than by two documents pointing in opposite directions.

Under this document's carve the resolution is clean: the `graph` sub-joint has a
`singleton` null member, which *is* "no decomposition", reachable, addressed and
measurable — so the capability survives as a member while the field itself goes.

### C-T2 — the enumeration's budget should be conditional on the partition (TIME lens)

`enumDeadline` rations the enumeration by a fraction of the turn —
and the shipped fraction is **`budgetFraction: 0.35`**, i.e. **just over a third
of the whole decision** is reserved for the proposal generator before the anytime
kernel refines anything. Finding D-2 says the enumeration is worthless on
scattered boards (88.7% singletons → the composed joint is the per-unit argmax →
`minHamming` filters it out) and valuable on the crowded tail. The ration is
blind to that.

The time lens's allowance-grant design is the right place for the fix and its
vocabulary already fits: the enumeration should be a **hypothesis in the
hypothesis market** whose bid is a function of the partition it found — largest
component size, or `worstClusterCells` — rather than a fixed turn fraction. That
is one row in their market table, not a new mechanism. **Ask: does the
hypothesis market admit a bidder whose bid depends on the result of a cheap
prefix of its own work?** (`partitionOf` is cheap; `enumerateProposals` is not.)

### C-B2 — the partition is computed on beliefs and never re-derived on evidence (BELIEF lens)

`influenceOf` reads possibility clouds. Under fog those clouds dilate every
turn, so the interaction graph is a function of the belief state — and a
conditioning event (their C0/C1/C2 ladder) can *shrink* a cloud and therefore
*split* a component. With `schedule = once-per-decision`, a mid-decision
narrowing that would have simplified the board cannot reach the partition. This
costs nothing today (no mid-decision observations exist) and costs a lot under
the fog programme, where the whole point of C1/C2 is that evidence arrives
during play.

**Ask: is a conditioning event one of the things that invalidates a partition?**
Under their reducibility-tag design it should be: the tag says *what can remove
this width*, and for a held unit whose hold is game-imposed the answer is
"observation" — which is precisely the event that should trigger
`schedule = on-observation`.

## 7. Build order

| # | increment | cost | what it decides |
|---|---|---|---|
| **D0⁻** | **the induced-width distribution** of conflict graphs over the replay archive (§4b½ iv) | one integer per decision, analysis on existing replays | how much of variable elimination is available at all — and it is the premise coordinate a conditional solver selector reads. Free, and it gates two members |
| **D0** | coverage instrument (Finding D-1): `planDistance(staged, nearestProposal)` per decision | one loop over ≤32 proposals | whether the enumeration contributes to the plan we actually stage. No design survives a "distance 4 on 90% of decisions" answer |
| **D0½** | **a law-suite subject with a SET-VALUED position** (Finding D-5) | one fixture | the cheapest possible prophylactic. It makes cluster-enum's "cross-cluster terms are provably zero" identity break *inside the suite, localised*, on the day the observation model changes — instead of surfacing later as an unlocalisable regression. Spec it now; it costs a fixture and it is the difference between a caught break and a hunt |
| **D1** | write Laws D1 **and D2** down and give them a structural test (the scout's import-law test is the model: nothing under `search/cluster-*` may be imported by `bounds/`). D2's clause: *cuts at public-state boundaries only; geometry is the full-observability special case* | a test + a paragraph | prevents the one failure mode the architecture is currently safe from by accident, and puts the fog clause in before anyone builds on the decomposition — retrofitting a public-state cut into a geometric one is a rewrite; adding the clause now is a paragraph |
| **D2** | the `focus` sub-joint with two members — `fixed-order` (today) and `deficit-seeded` — plus **cluster-conditioned re-enumeration** as the operator it feeds (§5) | small: existing `conditioned` path, existing signals | the largest capability-per-ms item found. Falsifier: it must beat today on the crowded tail *and* not regress the 88.7% scattered case, which `minHamming` already protects |
| **D3** | `schedule` sub-joint: add `on-refusal` (re-enumerate when `adjudication.refused` or the ratchet's `switch-floor` spikes) | small | whether re-derivation timing matters independently of focus |
| **D4** | `size` sub-joint + a bandit over `(focus, size)` per BALANCE — **only after D2/D3 show the two dials both matter**, and rule-based members only (the 2025 re-evaluation) | medium | — |

D0 first, and D0 is one loop. Everything in this document is downstream of the
question "does the enumeration reach the plan we stage", and nobody has asked
it.
