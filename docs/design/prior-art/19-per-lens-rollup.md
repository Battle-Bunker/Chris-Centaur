# PRIOR ART — per-lens rollup

**This document is the librarian's delivery channel** (owner ruling 52: findings
route here rather than through messages; the lenses cross-read it directly). It
is kept current — when a new prior-art document lands, its per-lens items are
added here the same commit.

Organised by **whose design each finding changes**, so each lens reads one
section. `README.md` is organised by domain instead; every item below names the
domain file that argues it (`d17` = `17-…md`).

Items are marked: **[C]** contradicts something the lens has written · **[M]**
covers a case the lens has not · **[+]** corroborates, with an argument the lens
can use · **[?]** an open question the survey raises but cannot settle.

## Read path

| section | for | contents |
|---|---|---|
| **A** | BELIEF | the object, the two structural gaps, the constructive answers |
| **B** | TIME | the CPP's second axis, lazy invalidation, the minimal carried object |
| **C** | VALUE | the fold's scope, `room`'s second correction, the measurement laws |
| **D** | COMPOSITION | the reduction retype, addressing, the manifest, the carve criterion |
| **E** | SEARCH | `cluster-enum.ts` — **no lens owns this** |
| **F** | MEASUREMENT | the ruling-49 instruments — **no lens owns this either** |
| **G** | running log | everything landed after domain 19, newest last, tagged by lens |

**Sections E and F still have no owner.** E carries the coordination-graph
finding and the `φ_uv` hypothesis assertion; F carries the six instruments that
between them make both halves of ruling 49's concern quantitative. If capacity
frees up, those are the gaps.

## Running log — index by lens

Later additions live in **§G**, appended in order. Index:

- **BELIEF** — d20 the logit/quantal-response successor · d28 the alignment meter
  must be rank-based (R-8b) · d31 `advisoryPrecision` gets a coverage producer
- **TIME** — d29 the one index · (d16, d23 in §B)
- **VALUE** — d21 cyclicity is unasked not answered · d24 the plans no weighting
  can reach · d26 the dead-cell detector and instance coverage · d27 few-run
  statistics · d30 MDE and the decision/significance split (R-9) · d31
  extrapolation error · d32 accounting devices vs policy levers (Ng's converse)
- **COMPOSITION** — d22 the option-value pricing and Parnas's criterion · d24 the
  combination law is a member collection · d29 the one index · d32 where policy
  actually lives
- **ALL** — R-6 hypotheses are executable · R-7 modularity is priced · R-8/8b/8c →
  **R-9** (a statistic's limit) · **R-10** (a statistic's invariances vs the
  hypothesis)

---

## A. BELIEF (design/belief-fog)

### The two structural gaps

**[C] Nothing in the architecture makes information valuable — QMDP's failure
mode.** (d8) Information enters the economy (contingencies → spending; the
reducibility tag; hedged preparation buys reaction latency) but never the
**action value**. No term says *this move is worth playing because it would
collapse a cloud*. Prediction: under invisibility potions the bot will hold,
hedge and pre-compute, and will never spend a move to scout, even when three
cells of walking would settle the question. The fix is a type, not a heuristic:
`VOI = E[value | post-observation belief] − value | current belief`, sitting in
the ACTION ordering as a flow. Both lenses have the pieces; nobody owns the seam.

**[C] Γ-maximin (ε = 1) is the dual of the same gap** (d3). Troffaes: E-admissibility,
maximality and interval dominance all shrink their optimal set as beliefs sharpen;
Γ-maximin and Γ-maximax explicitly **lack** that property and "usually only select
a single decision, even in case of complete ignorance". So the reduction cannot
express "I now know more", and no action term rewards learning more. Two
mechanisms, one symptom, in the programme whose flagship feature is fog.

### The object

**[C] ε=1 is not "the adversarial zero point"** (d1). In a simultaneous-move game
the min over enemy *pure* actions is the pure security level, strictly below the
stage game's value, and it is the value of a concept where we move first and are
seen. The field's zero point is the stage matrix's **NE**, solved by LP — a
distribution, not a scalar. Needs a third reading beside sound/advised:
**equilibrium**, whose supplier is a fixed point rather than a chosen weight.

**[C] Our ε formula is Walley's linear-vacuous mixture, and that class DILATES**
(d3). Conditioning can widen the credal set *for every element of a partition*
(Seidenfeld & Wasserman). Our laws protect the support (deduction only — real
credit) and leave the **weight** unprotected: `advisoryPrecision` is treated as
monotone in evidence and is not, and the reappearance oracle audits S so it is
blind to this. Cheap structural test: dilation requires the credal set to
intersect the independence plane, and the vacuous `'adversarial'` supplier
trivially does — it is the maximally dilation-prone member.

**[C] Terminology collision**: we use *dilation* for dynamics-driven spread; the
field reserves it for the conditioning pathology. Rename ours to **spread**.

**[C] `meet = narrow` is false for the weight half** (d3, and it is a joints-lens
item too). The economy can pay for an observation that provably dilates and has
no way to refuse.

### The constructive answers

**[M] The conditioning ladder is a CSP and Minesweeper is its solved special
case** (d13). C0 = cardinality constraint, C1 = **disjunction**, C2 = **negative
joint**. Keep a **constraint store partitioned into coupled subsets**; derive
marginals by query. This is the answer to the marginal-storage problem: per-unit
marginals cannot hold C1 or C2, so those rungs evaporate at storage and will
measure as worthless when they are merely unstorable.

**[M] Solution counting is the canonical weight** (d13) — "solutions with this
variable set / total solutions". It makes the design's own claim
("cover-counting is the canonical w that S itself induces") literally true, and it
gives the supplier slate the principled default it lacks: **uniform over the
constraint system's solutions**, which is well-defined where bare "uniform" is
not. Caveat: counting is #P-hard, so the approximation must be **declared** —
and that declaration is `advisoryPrecision`'s first concrete producer.

**[M] ε should be a ledger, not a dial** (d15). Ganzfried & Sandholm achieve safe
exploitation "by risking in exploitability at most what has been earned over the
Nash equilibrium in previous rounds". So how far we may depart from the floor is
**computable**. In our currency the budget is `realised share − floor share` —
one more account in the existing ledger, no new unit — and it upgrades the sound
floor from a veto into the **zero of a risk account**. Keep an operator control,
but as a cap on how much banked advantage may be staked; that has an
interpretable unit, "what is your ε?" does not. **This is a better answer to
dilemma 2 than either option put to the owner.**

**[M] Add a gift detector** (d15). Deviation is licensed by an observable event —
the enemy played something that is not a best response to any of our equilibrium
strategies — and the replay-rebase mechanism already reconstructs what one needs.
Test against our own floor computation, not a dominated-move threshold, or most
gifts are missed.

**[M] Define the public state, and make it the only legal decomposition
boundary** (d12). Geometry is not a legal cut once positions are sets.

**[M] `Belief(observer)` should be indexed on the operator too** (d10) —
Miller's fourth finding makes the explainee's beliefs part of the explanation,
and the constructor is already being built for an adversarial reason.

**[+] The fog programme is heading into a solved subclass** (d8): one-sided POSGs
(Horák & Bošanský — the same group as the simultaneous-move survey), evaluated on
pursuit-evasion, patrolling and **search games**, which is what a hidden collector
plus a truthful item board makes our board. There is a benchmark literature to
sanity-check the machinery against.

**[?] Restrict observation branching DESPOT-style** (d8) — K sampled scenarios,
all action branches, a stated regret bound — rather than by a cap, when the time
comes.

---

## B. TIME (design/time-interruption)

**[C] A saturating CPP is not self-interpreting** (d16 — written against the v0
result). Two readings with opposite remedies: "search exhausted" (shorten the
contract, fund ponder) vs "the evaluator is too coarse for depth to bite on"
(fix the evaluator; saturation lifts). The chess literature says the second
historically dominates and *masquerades* as the first — it hid diminishing
returns for fifteen years. Our evaluator is measured weight-blind, and the
reported pattern (snake6 saturates, the queen board keeps climbing) is what the
second reading predicts. **Discriminator: a second CPP axis, the margin at the
deciding rung.** Also: **key the CPP on `evalVersion`** — the saturation point is
a property of the evaluator.

**[C] `observe()` kills eagerly; the field dirties then verifies on demand**
(d6). Eager invalidation spends the scarcest compute at the worst moment
(operator commit, deadline approaching) on work this turn may never demand.
Adapton/Salsa: mark dirty (cheap, O(edges)), recompute on demand, cut early.

**[C] Record VALUE HASHES, not just coordinates** (R-1, d5/d6/d4). Read-sets
alone give dirty-bit semantics; hashes give minimality **and early cutoff**, which
is what `feature/commit-scope` is actually trying to buy. Three unrelated
literatures land on this.

**[C] Re-base is continual re-solving, and that is sound only with bounded
counterfactual values crossing the boundary** (d12). Carrying nothing is the
*unsafe* variant, with unbounded error and *increased exploitability*. ADVANCE's
payload needs a bound — a type the bounds bank already produces.

**[C] Bound the re-base window** (d6). GGPO caps rollback and stalls past the
cap; ours is limited only by how much work happened to be citation-dependent.

**[C] A per-turn checksum detects divergence but cannot localise it** (d6), and
GGPO's named desync causes are our hazards verbatim ("iteration over an unordered
collection"). Promote `subStepCount` + per-sub-step checksums out of "additive
polish".

**[C] The hypothesis market is missing its second factor** (d2). Russell & Wefald:
a computation's value comes *entirely* from its ability to change the chosen
action. `P(refinement flips better())` is a function of interval overlap at the
deciding rung — which `BankResult` already carries. Corollary that bites:
narrowing an uncontested rung is worth exactly **zero**, so pricing meets by
width systematically overspends away from decision boundaries.

**[M] The minimal carried object has a literature answer** (d12): DeepStack's
continual re-solving needs "minimal memory of how and why it acted" — and that
minimum is **the opponent's counterfactual value bounds at the public state**.
Far smaller than the carry store, the hypothesis table or the attention map, and
the only candidate with a soundness theorem attached.

**[M] Geometric tranches, ratio 2, penalty ≤ 4** (d2) — Zilberstein's reduction
theorem. A fitted value whose **provenance is a theorem** rather than a sweep,
which is a provenance class ruling 49 does not yet name.

**[M] Monitoring must beat a fixed contract** (d2). Hansen & Zilberstein's method
"only recommends monitoring if it results in a higher expected value than
allocating a fixed running time without monitoring", and the payoff scales with
**profile variance**. If our per-tranche improvement is low-variance, the correct
design is *fewer* interruption points and larger contracts.

**[M] The free market baseline is "the enemy repeats"** (d6) — GGPO's predictor
carries an entire genre. A market member that cannot beat it is not earning its
allowance.

**[M] "Ask the operator" is a purchasable observation with no row in the economy**
(d10). Three ways to remove width: deduce, observe, ask. We have the first.

**[M] α-vectors stay valid over belief *regions*** (d8) — a much stronger
cross-turn carry than a scalar bridge or a matched hypothesis.

**[?] Charge for the selector's feature computation** (d14). SATzilla budgets it
and keeps a fallback; ours would compute the expensive features inside the
decision budget, and the metareasoning partition says that comes out of
base-level work.

---

## C. VALUE (design/value-evaluation)

**[+] Per-unit weight accounts ARE KataGo's ownership head** (d4), arrived at
independently, down to the board-area normalisation (`w_o = 1.5/b²` ≈ our `K/W`).
And KataGo supplies the argument the lens has not made: **the decomposition's
payoff is credit assignment from few samples** — *"with an ownership target the
net receives direct feedback on which area of the board was mispredicted, with
errors and gradients localized"* — which is the direct answer to ruling 49's
low-density worry.

**[M] Promote per-unit flows to standing telemetry** (d4). 144 games become
thousands of unit-observations at zero play cost. The cheapest response to "the
config space is explored at low density".

**[C] Corrected: the fold is fine; `partitionOf` is the problem** (d4, checked
against source). `(K, W, p)` is a per-turn **constant**, so the derived fold is
*more* incrementalisable than the shipped evaluator — my first phrasing had this
backwards. The un-incrementalisable object is `partitionOf`, a whole-board
set-cover over every admitted unit recomputed per reading, where one unit's plan
alters every unit's cell count. `feature/commit-scope` therefore rests on
cluster/reading-granularity invalidation, not per-term incrementality.

**[M] `room` should count edges, not cells** (d7). a1k0n mined hundreds of
thousands of Tron games: `K₁(N₁−N₂) + K₂(E₁−E₂)` with **K₁ ≈ 0.055, K₂ ≈ 0.194** —
edges carry ~3.5× the weight of cells. A *second* independent correction to the
same term the lens is already correcting, and it says the **quantity being
counted** is wrong, not only its coefficient. Reproducible on our archive with the
lens's existing tooling.

**[M] The checkerboard parity bound** (d7): movement alternates colours, so count
the two colours separately for a strictly tighter **sound** upper bound on
reachable territory. Free, and it belongs in the bounds bank, not an evaluator.
(Check the bipartite argument survives our slider/jump rules — it is a trail-unit
bound.)

**[M] The articulation-point chamber tree** (d7): a1k0n reports **12–1** for it in
the ancestor game, and it is largely re-use of our existing component
decomposition. It is the shape the `room` family is missing.

**[C] Every headline number is a non-invariant aggregate over a redundant
population** (d9). Balduzzi et al.'s invariance axiom *excludes Elo and uniform
averaging by name*, and their Atari re-evaluation **reversed** a headline
conclusion rather than merely widening it.

**[M] mElo's latent-skill decomposition answers "what does this cell test?"** (d9)
— the dead knight cell would appear as a near-zero singular value automatically.
Subsumes M5.

**[M] The Centaur surface must be built on FLOWS, not the aggregate** (d10).
Miller: statistical generalisations are the least effective explanation;
`Contribution{unit, flow, side, rate, horizon}` is a causal vocabulary. Practical
consequence: **do not sum the flows before caching**, or the causal content dies
at the memo boundary.

**[M] The risk budget is one more account** (d15), denominated in
`realised share − floor share`. No new unit, no new currency.

**[M] Your M2 instrument has four consumers** (d16): point-of-comparison spread by
unit class is *also* the time lens's CPP discriminator, *also* the contrastive
explanation column, *also* the VOI input. That ratio should move it to the top of
the build order.

**[?] For every admission filter, measure error on what it REMOVES** (d4). Texel
paid ~39 Elo for a principled-looking filter he never measured that way; we have
four such filters and have measured none of them.

---

## D. COMPOSITION (design/joints-composition)

**[C] REDUCTION must return a SET with dominance conditions, not a scalar**
(R-4; d3, d8, d10). Three unrelated fields converge: maximality's optimal set,
α-vectors' dominance regions, explanation's (fact, foil). The joint's type should
be `Gambles → Set of (option, condition)`, with "collapse to a scalar"
(Γ-maximin) as **one member**. The chief refusal — "no joint with one member" —
applies to REDUCTION itself; the literature hands us four, and d7 hands us
{paranoid, MaxN, share-weighted asymmetric fold} on top.

**[C] "Law per joint kind" IS Zilberstein's local compilation** (d2) — a theorem
whose optimality hypothesis is a **tree**, where global allocation is NP-complete
in the strong sense and the hardness construction is a DAG. Our manifest shares
sub-results by design. Declare the allocation projection and prove it a tree, or
drop the optimality claim.

**[C] `botId` is a deep constructive trace** (d5) — the one rebuild strategy that
provably cannot early-cut. Behaviour-preserving config edits cold every memo, and
two identical bots get different addresses. Fix: **Nix's resolved derivation** —
address the *resolved* closure, which also states the reachability law over the
right object.

**[C] Identity-for-reuse and equality-for-dedup are two keys with opposite laws**
(d6). A name must be stable across the change you want to be incremental in; a
content hash must not be. Every cross-turn mechanism (attention carry, warm
promotion, ADVANCE) is a **reuse** problem, not a dedup problem. Composition risk
1 ("premise ids could churn") is really "the *name* churns", and **Salsa's
durability** is the built, measured version of the stable/volatile split.

**[C] The premise index needs a fifth coordinate under imperfect information**
(d12) — reach/range, or a counterfactual-value bound. Sound today, unsound after
fog step 5, and the cache returns a *plausible* wrong number. The lens has the
right mechanism and is missing exactly one coordinate.

**[C] B4 should expose the spawn DISTRIBUTION, not inject a sampler** (d11).
OpenSpiel makes chance an explicit player whose state exposes `chance_outcomes()`.
With an injected spawner the bot searches one sampled future and the potion window
either happens to open or does not; with a distribution it can price the
three-turn walk correctly **without the window opening in the sample** — and B4's
own acceptance game is precisely the case that separates them.

**[C] Exporting `adjudicate` fixes one rule; the defect CLASS is having no single
rules artifact** (d11). Three recorded instances are one class. Ludii/OpenSpiel:
one place a rule can be written, every consumer a derived reader.

**[C] Derive the manifest from the types with a checked bijection** (d11). Ludii's
class grammar gives "a guaranteed 1:1 mapping between the source code and the
grammar". A hand-maintained manifest is a **sixth home** for the joint list and
will drift like the other five. This is the strongest external validation of the
manifest move in the survey, and it argues for the more expensive version.

**[C] We have never measured our own VBS–SBS gap** (d14) — the falsifier for this
whole architecture. Everything proposed is infrastructure for *selecting among
members*; the field's first discipline is to measure whether selection has
headroom. Large ⟹ the quantitative case; small ⟹ the architecture must be pitched
on **hygiene**, which is a different and more honest claim. Compute it beside
Nash averaging: **redundancy and complementarity are different quantities and we
measure neither.**

**[C] Selection at config time cannot capture a per-instance gap** (d14), which
reframes the missing production bot-binding site from an operator convenience
into the mechanism without which the portfolio thesis is unexpressible.

**[+] `Choice = conditional` is Rice's selector and the premise index is Rice's
feature space** (d14). The two moves the lens made independently are the two
halves of one fifty-year-old formalism.

**[+] Prismata's Hierarchical Portfolio Search is the closest shipped precedent
for the whole carve** (d1) — a commercial simultaneous-move, combinatorial-action
game AI whose stated rationale for the portfolio architecture is **robustness to
balance changes**. Ruling 49's mandate, validated by a product.

**[M] Add the contract/interruptible column** (d2). "Naive composition destroys
interruptibility even when every component is interruptible." Our greedy incumbent
is the undesigned interruptibility witness — three literatures now say so
(Zilberstein, `cluster-enum.ts`, a1k0n's ply boundary).

**[M] An admission obligation for the ACTION joint** (R-3): *every candidate
restriction is adaptive on value or carries a bound on what it removed.* Four
members available: {fixed cap, **progressive widening**, per-variable bandit,
double-oracle}, with **induced width** as the selection feature (d13, d17).

**[M] "Is this member worth keeping?" gets a formal, ungameable answer** (d9):
**support in the meta-Nash**. Stronger than the reachability law's intent and
immune to the counter it already worries about.

**[M] Hypotheses belong in the manifest beside composition laws** (R-6, d18), and
should be generated as executable assertions with everything else. That is the
version that would have caught the switch override, the unpublished field and the
sim covenant.

**[M] ECS's three hard-won lessons** (d5): declared access buys **safety, not
order**; fine-grained keys are unstable under refactoring so coarsen
deliberately; and deliberate ambiguity needs a first-class annotation or the
checker becomes noise people disable.

---

## E. SEARCH (`cluster-enum.ts` and the closure) — no lens owns this

**[+] The order-2 Möbius surrogate is strictly stronger than the literature's
naïve assumption** `μ(X) ≈ Σᵢ μᵢ(Xᵢ)` that the whole CMAB family rests on (d1).
Exact inference where the field samples approximately. The design docs should say
so.

**[C] …and then the module throws that structure away** (d17). The surrogate *is*
a coordination graph. **Variable elimination** gets the same exact argmax at a
cost exponential in **induced width** rather than joint-space size — converting
the case that currently falls back to ICM into an exact one and decoupling a
slider's option count from its component's size. **ICM is coordinate ascent**, the
baseline two separate literatures name as the one their better algorithms beat;
**max-plus** is the anytime replacement with a monotone incumbent every round.

**[C] `φ_uv ≡ 0` is a perfect-information theorem** (d12) whose hypothesis is
"every unit is at a known cell". Assert the hypothesis **now** (d18), so fog trips
it on the first fogged decision instead of degrading the exactness claim
silently.

**[M] VE's conditional payoff function is R-4's object, free** (d17) — the
set-with-conditions three other domains independently demanded, emitted as a
by-product of the argmax, and a far better cache unit than a whole joint plan.

**[M] Measure the induced-width distribution on the archive** (d17). One integer
decides how much of this is available.

---

## F. Owner-facing / measurement — no lens owns this either

1. **Nash averaging** over the arm-vs-arm matrix → **redundancy** (d9).
2. **VBS − SBS** per seed → **complementarity** (d14).
3. **Cyclic fraction** of the same matrix (d9) — if our arms cycle, "which bot is
   better" is not a well-posed question, a roster must be a **mixture**, and the
   production binding gap becomes a blocker.
4. **Paired seat-swapped scenarios, pentanomial scoring** (d4) — and the
   pentanomial-vs-trinomial gap *is* an estimate of the population's bias.
5. **Metamorphic relations** (d18) — the one class of evidence whose verdicts do
   **not** depend on the scoring rule, and therefore the only class immune to the
   distortion ruling 49 names.
6. **PSRO-style roster growth** (d9): the next member to spec is the **best
   response to the roster's meta-strategy**, not the most interesting hypothesis.
   The procedural answer to "explored at low density".

---

## G. Running log — additions after domain 19, in order

Each entry is tagged with the lens it changes. Newest at the bottom.

**BELIEF — the solutions supplier's successor** (d20). Their refutation of my M38
is correct: Minesweeper's hidden variable really is drawn uniformly subject to the
constraints, so solution counting recovers the *true generative measure* there;
ours is chosen by an **optimiser**. The successor is one parameter away and their
refuted supplier is its zero point: **`logit(β)` over the solution set** =
Jaynes's max-entropy-with-a-value-constraint = McKelvey & Palfrey's **quantal
response**, with β = 0 their v0 and β → ∞ the argmax their diagnosis names. It
collapses most of the slate into one member with one fitted parameter, their
harness can fit β today on the strata they already have, and the obvious `V` is
`cluster-enum.ts`'s surrogate. General lesson: **a max-entropy measure over a
feasible set models an exchangeable generator; ours are optimisers.**

**BELIEF + SEARCH** (d20). Max-plus is the β → ∞ limit of sum-product on the same
factor graph, so one `(graph, β)` module serves the search's argmax **and** the
belief's weight supplier. The team's action-selection surrogate and the opponent
model over teammates are the same object at two temperatures.

**VALUE — the cyclicity question is unasked, not answered** (d21). Their
telescoping result is correct and more general than stated: *any* statistic of the
form `Δ(X,Y) = m(X) − m(Y)` is a gradient field with zero curl by construction, at
any seat count. So the conclusion is "the instrument cannot represent cyclicity",
not "the game is transitive" — Balduzzi's decomposition is defined on **logit**
matrices for exactly this reason. Cheapest statistic that *can* carry curl and is
already in the archive: **pairwise finishing order within each shared game**.

**VALUE** (d21). Qualify "hygiene, not strength" with **"for this pool"**; the
+0.996 duplicate pair makes the null a lower bound, and the portfolio literature
says value = complementarity of constituents. Their cross-cell profile-correlation
redundancy measure is a **methodological improvement** on the Nash averaging I
proposed and should be the standing column.

**COMPOSITION / OWNER — the pitch, priced** (d22, R-7). Baldwin & Clark: net
option value scales with `σ`, the technical potential of what might be plugged in,
plus experiment cost and visibility. A null measured over near-duplicates measures
**σ ≈ 0 for that pool**, not the architecture. The honest pitch is **the option
value of members that do not yet exist**; the two levers we control are experiment
cost and visibility.

**COMPOSITION** (d22). Our carve criterion (the game's irreducible facts) is not
Parnas's (what changes independently), and two of our own findings say the kinds
are coupled (REDUCTION↔VALUE via ε; ACTION↔ECONOMY via widening and
budget-dependent closure). Test it: **a design structure matrix mined from git
co-change**. Also: add **inversion** to the vocabulary — every "written N times"
defect is a missing one — and adopt a **visible-layer budget**, since everything
hidden pays for the size of the design rules and this survey alone has proposed
five additions to ours.

**BOUNDS / BELIEF — the dependency problem, twice** (d23). `cluster-enum.ts` §5.5
already identifies and correctly refuses the cheap decoupled enemy-min ("the enemy
min does not distribute over a sum") — the best piece of bound engineering in the
codebase, and it is an instance of interval arithmetic's oldest known failure
mode. **Name it as such, because that is what makes the second instance
findable:** under fog the hidden-unit configuration is a *second* shared
uncertainty source, so `Σ_u min_h f_u(h) ≤ min_h Σ_u f_u(h)` and a design that
clouds per unit then combines produces a floor degrading with the NUMBER OF UNITS
AT RISK rather than with the amount of uncertainty — sound and ordering-free,
which is the saturated-floor symptom domains 1 and 3 predicted from decision
theory. Remedy fits the existing type: affine arithmetic's shared **noise
symbols** are structurally our `assumptions`, and the missing capability is to let
a shared basis **tighten** a combination rather than only refuse one. Cheap test
on the existing archive: decoupled vs exact joint minimum, gap by unit count.

**VALUE / COMPOSITION — the plans no weighting can reach** (d24). Weighted-sum
scalarization provably recovers only Pareto points on the **convex hull**; the
rest are unattainable at every weight. The VALUE kind's law is a weighted monoid,
so **"we swept the weight and found nothing" is not evidence a term is
worthless** — add **(d) non-convexity** to the inert-weight taxonomy, whose
signature (real spread at the comparison, no monotone-then-worse curve, option
admitted, and the argmax **jumping** between plans as `w` crosses a threshold) is
visible in sweep data already held. The combination law should be a member
collection {weighted sum, Chebyshev, ε-constraint, lexicographic} with known
reachability per member; Chebyshev reaches everything and is `max` for `Σ` against
the bank's ceiling as reference point. And migrating lexicographic → additive is
an improvement in derivability and legibility, **not in expressiveness** — the two
have different reachable sets, which is also *why* the value lens's withdrawn
"one dial interpolates lexicographic↔additive" claim had to be withdrawn.

**VALUE / MEASUREMENT — instance space** (d26). The knight cell has been
diagnosed as a dead instrument **three times by three routes**, each costing an
investigation. The automatic detector is one column over the arm × cell matrix
POP-1 already builds: **deadness = the spread of ARM performance on a cell,
relative to that cell's within-arm noise floor.** Distinct from M5 — M5 asks
whether the *outcome* varies, deadness asks whether it varies *between arms*, and
a cell high on the first and zero on the second is the worst case for spending a
block. Then **feature the cells and plot the instance space** (every feature is
cheap and most are computed: roster composition, (K,W,p), geometry, induced
width, contested density, spawn rate, team count) — which converts "we have four
cells" into a **coverage statement**, the half of ruling 49's concern that nothing
currently addresses. And the first measurement-derived experiment design the
programme has: the cyclic component reverses sign between snake and piece boards,
so **evolve instances along that direction** and test near the crossing point.
Smith-Miles's ISA is an explicit extension of **Rice's framework**, so its
**footprints are the fitted `Choice = conditional` selector** with statistical
support attached.

**MEASUREMENT — few-run statistics** (d27). The RL community's reckoning with our
exact situation ended in an adoptable standard, and its headline finding is the
uncomfortable one: *"a number of improvements reported in the existing literature
are only 50–70% likely."* Adopt outright: **stratified bootstrap CIs** (stratify by
cell × seat × seed — the structure paired seats already create; explicitly better
justified than sample SDs at small n) and **probability of improvement** with its
own interval on every standing verdict — that is the quantity ruling 49's doubt is
actually about, in one number. Adopt for cross-cell reporting: **performance
profiles**, because we have now *measured* a case where an aggregate is zero
because two opposite things happen (d25's sign reversal). Adopt **IQM for the
across-cell aggregate only** — a dead cell is an outlier task — and not within
cells, where hundreds of games make the mean right; adopting it everywhere would
import a fix for a problem we only half have. And a standing caution: **a pinned
seed is reproducible, not representative** — our determinism work removes two of
the three known failure sources, and reproducibility makes an unrepresentative
sample harder to detect, not easier.

**VALUE / BELIEF — extrapolation error** (d31). The fold is fitted on flows that
OCCURRED and is intended to price plans that were NEVER PLAYED, under an
**argmax** — which offline RL identifies as the operator that *selects for*
extrapolation error rather than sampling it (*"agents learn to prefer
out-of-distribution actions whose value has been overestimated"*). Scope it
correctly, because the counter-argument is strong: **the fold's ACCOUNTING half is
near-identity and safe to extrapolate; the flow ESTIMATORS are not** — which is the
value lens's own §6.2 caveat with a mechanism and a direction attached. Cheap test
on the existing archive: bin scored decisions by distance from the nearest
same-shape plan in the fitting corpus, report residual per bin. And the remedy
family lands on machinery we have: **`advisoryPrecision` gets a second producer
(coverage distance)**, which is CQL's pessimism in our own vocabulary, with domain
15's risk budget as its consumer. Read together with the belief lens's queued
alignment meter: extrapolation error predicts the fold retrodicts OUTCOMES well
while ordering COUNTERFACTUALS less well, so a mediocre meter beside an excellent
R² is this mechanism's signature, not a contradiction.

**VALUE / COMPOSITION — accounting devices vs policy levers** (d32). "The fold is
an accounting device, not a policy lever" is **Ng, Harada & Russell's theorem**,
and its **converse** is the useful half: potential-based shaping is *necessary as
well as sufficient* for policy invariance. So the contrapositive is a design test
the VALUE joint lacks — **a term that CAN change the policy must not be expressible
as a potential difference or a positive rescaling; a term that IS so expressible
can only buy variance reduction.** Sorting the twelve slots and three flows by that
test is an afternoon. And it composes with d24 into a sharper carve than either
lens had: **the currency is accounting and near-definitional; the COMBINATION LAW
over it is the policy lever**, and that law is a member collection with a
reachability theorem per member. Which resolves why the fold's excellent R² and
its policy-inertness are both true, and says the remaining design attention
belongs in the combination law rather than in more flow channels.

**COMPOSITION / TIME / SEARCH — R-4's cost objection answered** (d33). R-4 had four
arguments and one open objection: cost. It does not survive.
- **Size**: expected non-dominated set is `O((ln n)^{d−1})` (Bentley–Kung, JACM
  1978) — **~9 of a queen's 71 options at three objectives**; small exactly when
  the objectives are few, which is where the currency work is heading.
- **When it blows up** (anti-correlated objectives, i.e. real trade-offs — the
  honest counterweight): **Papadimitriou–Yannakakis** guarantee a
  **polynomially-sized ε-approximate Pareto set** with a stated (1+ε) bound. That
  is **R-3 satisfied for the reduction's OUTPUT** rather than its input. Default
  implementation is **ε-dominance grid pruning** — O(1) per candidate, no LP.
- **Dominance conditions are free**: they are the pruning LP's own witness, and
  that LP is the standard POMDP α-vector usefulness test. Pipeline: pointwise
  dominance → **interval dominance** (2n vs maximality's n²−n, sound as a
  pre-filter) → LP on survivors only.
- **TIME**: the set is *better* under interruption than a scalar argmax — it
  shrinks **monotonically** under refinement, so an interrupted reduction returns a
  **sound superset** rather than a possibly-wrong pick. And it supplies the spend
  target C8 asked for and could not compute: **the pair whose dominance is closest
  to decided, measured by the LP's slack.**
- **Joint reading with d32**: the VALUE joint's shape is now fully specified —
  *flows in a common currency (accounting, near-definitional) → a non-dominated set
  with dominance regions (computable, ~9 members, ε-bounded) → a combination law
  chosen from a member collection with a reachability theorem per member (the
  policy lever)*. The scalar collapse happens only at the last layer, and only if a
  collapsing member is selected.

**TIME — the hypothesis market's missing algorithm** (d34). The market is
specified as a policy with no algorithm. Weitzman's Pandora's box gives the clean
version an **optimal INDEX policy**: each alternative has a **reservation value**
`σ` solving `E[max(x − σ, 0)] = cost` — *the value at which the expected gain from
opening equals the cost* — depending **only on that alternative's own distribution
and cost**; open in decreasing `σ`; **stop when the best in hand exceeds the
largest remaining `σ`**. Every term is now available: the **CPP** supplies the
improvement distribution, the **ledger** supplies the cost. So CPP + Weitzman is
the market's first actual algorithm, and the stopping rule is the one the economy
lacks (today only the deadline stops it).

Adopt it as a **member with a known failure direction, not as optimal** — our
problem leaves the regime in three places: **repeated inspection** (Gittins rather
than Pandora; condition the index on quanta already spent, which the CPP does),
**correlation** (the index **over-values the second of two correlated
hypotheses**; discount by read-set overlap, which the declaration record can
compute), and **non-obligatory inspection** — the reaction table's "conform now"
row makes ours the *provably harder* variant, and the index degrades exactly near
the deadline, which is when the market matters most.

Correction to **C8**: the two probabilities are the *payoff distribution*, not the
score. The score also needs the **tranche's price** — so an expensive
high-flip-probability hypothesis can correctly rank below a cheap low-flip one,
which the product formulation cannot express.

**VALUE / BELIEF — C60 measured, and M77 corrected** (d31 §31.5). The distance test
fires (`corr = +0.423`) but **the structure is a MECHANISM STEP, not a distance
slope**: king-present cells mean |residual| 1.946 vs no-king 0.201 — a **9.7× step**
with `corr(king, residual) = +0.954` — and **within the no-king stratum
`corr(distance, residual) = −0.562`**, so the six *farthest* cells have the
*lowest* residuals. Cause is the wipe-closure defect (the fold prices a death at
the dying unit's balance; a last king's death removes the whole team).
**Corrected M77: `advisoryPrecision`'s coverage producer must be a MECHANISM
INDICATOR, not a distance** — the literature's own split is *covariate shift*
(distance is meaningful) versus *concept shift* (the input→output relation changes
discontinuously; distance-based detection is blind to it, and can point the wrong
way). The mechanism list is short and **enumerable from the rules**, which makes it
cheaper and more auditable than a distance metric — and a mechanism is a **premise
coordinate** (d29), so it has a home already.

**ALL — R-11** (d31 §31.5). *An aggregate can be zero, or the wrong sign, because
two opposite things happen. Report stratified by the obvious mechanism before
reporting pooled.* **Third instance this session**: the cyclic component reversing
between board families and cancelling on pooling; the VBS−SBS null that may be a
pooling artifact of exactly that reversal; and now pooled `+0.423` against
within-stratum `−0.562`. That is enough to make d27's performance-profile
recommendation a standing rule rather than a suggestion.

---

**COMPOSITION / SEARCH / VALUE — C61, M84–M86: the closure is a shield, and ours
has neither of a shield's two guarantees** (d35).

The formal-methods object for "a filter between the agent and the world" is a
**shield**: synthesized from a temporal-logic safety specification, sitting outside
the learner, with two properties that are the reason it is a design pattern rather
than a technique — **correctness by construction** (it enforces *the specification*,
not whatever the predicate's author remembered) and **minimal interference** (it
intervenes *only* where a violation would occur, which is what preserves the
agent's guarantees).

`[+]` **COMPOSITION, your kernel ruling is right and shielding says why in a
stronger form.** "Set-closures stay kernel even though they are numbers" is
correct: a closure is not a preference, it is a *specification enforcement point*.
And ours are **pre-decision** shields (they remove candidates before pricing),
which is the architecture the literature prefers — worth naming, because the
alternative exists and is worse: a post-decision veto leaves the comparator
ranking plans it must then discard, which is the shape "the closure runs after the
comparator sorts" defects come from.

**C61 — neither guarantee holds for us.** `certainlySelfFatal`, `keepQuiet: 2`,
the tier lattice bottom and the staging-safety exclusion implement a safety intent
that exists **only in prose**, so there is nothing to check them against — and this
is the highest-stakes place to have a hand-written re-derivation of the rules,
because the deletion is invisible downstream. (The programme has already paid once
for this class: d11's C35, the bot re-deriving movement three wrong ways.) Minimal
interference is not merely unproven, it is **unmeasured**. This is the sharpest
form of R-3: a hard filter is the one restriction that should be neither adaptive
nor bounded — which makes the third obligation binding instead, *derived from a
stated specification, interference minimal and measured*.

**M84 — SEARCH, one counter per closure, existing archive.** "How often, and by
how much, does each closure remove the plan the unfiltered search would have
chosen?" Three uses: it measures interference directly; it separates a closure that
never binds (delete it) from one that binds constantly (a *policy* in the wrong
layer); and it is the same shape as the deadness column (d30) and the admitted-set
instrument, so the harness exists.

**M85 — COMPOSITION, correctness-by-construction's *effect* without the
machinery.** The useful half of shield synthesis is not the synthesis, it is **the
specification existing as a separate artifact from the predicate**. Two steps:
state each closure's specification in the **rules module** (d11) as a predicate
over the *game's* vocabulary — *"a plan is self-fatal iff the rules engine's
resolution of it kills the moving unit"* — then **differential-test** it against
the engine on the replay archive (the free-differential pattern the replay-rebase
design already established, d6), and **assert it per R-6** so drift throws rather
than silently over-removing.

**M86 — VALUE, your refusal has a literature.** `tier` must stay precedence and
"must never become a weight" is the shielding literature's core distinction in our
vocabulary: **a safety specification is not a very large penalty.** A penalty is
tradeable at some weight; a shield is not tradeable at any. Cite it, because "just
make it a big negative number" is the reflexive simplification a future cycle will
propose, and it should be refused with a citation rather than by taste.

**The counter-argument, which locates the finding rather than weakening it.**
Shields are synthesized over *known* dynamics; ours must act before the resolution
is computed — that is what "certainly" in `certainlySelfFatal` means. So exact
minimal interference is unattainable: any sound pre-decision filter over an
undetermined resolution must over-remove somewhere. The obligation therefore
becomes **state the conservative margin — this closure removes `X ∪ Δ` — and
measure `Δ`**, which is exactly M84's counter, and is R-3 applied to the one
restriction class the survey had not yet reached.

---

**ALL — domain 36: algorithm CONFIGURATION, the field whose entire subject is the
knob bag.** Domain 14 surveyed algorithm *selection*; this is its sibling, and it
is the one that bears on **ruling 49**. Thirty years of literature on *what values
a parametrised algorithm's knobs should take, and what a fitted value's provenance
must contain*. It was the survey's largest gap.

**VALUE / OWNER / MEASUREMENT — C62 and R-12: your seed-population finding is not
a reporting item, it is the missing half of the objective.** The field writes the
problem as

  `θ* ∈ argmin_θ ∫_I c(i,θ) dP(i)`

over a population `P` on the instance space — and then says plainly that `P` is
unknown in practice, *"and thus we must resort to solving a **proxy problem**"*
over a training instance set, "similar to empirical risk minimization". So the
provenance tuple is `(Θ, c, m, I_train, P, budget)`. Your `MEAS-4` §4 statement is
exactly right — *"perfectly reproducible and not drawn from any declared
population"* — and what this adds is **where the defect sits**: not in the report,
in equation (1). A pinned contiguous seed range is a fine `I_train`; the missing
object is the `P` it is a draw from, and without it the minimised quantity is
undefined rather than imprecisely estimated. Your own **0.427→0.530 spawn-geometry
swing** is the size of the term. **R-12** generalises it: this is the common root
of the undeclared seed population, extrapolation error's in-/out-of-distribution
split (d31), instance-space coverage (d26), Nash averaging's population redundancy
(d9), and ruling 49's "explored at low density". And for a two-player game `P` is
a *joint* distribution over boards, seats, seeds **and opponents** — so naming it
requires an equilibrium over the roster, not a list of arms. **C62 and C29/C30
compose.**

**MEASUREMENT / TIME — C63: race and cap, but stop averaging the survivors.** Two
halves that pull opposite ways.
  - You can afford **far more comparisons** than an all-games-to-completion
    protocol implies. F-Race discards inferior configurations as soon as a
    non-parametric test says so; ParamILS accepts a configuration only if it was
    evaluated on **more** instances **and** had lower cost on those; SMAC compares
    only on the **same** sampled instances and seeds (your stratified bootstrap's
    procedural twin); LeapsAndBounds sets phase budgets by **empirical Bernstein
    stopping**, which adapts to the observed range and variance instead of a
    pre-committed `n` (**M90** — the *procedure* d27 could only give statistics
    for, and it composes with the bootstrap you built).
  - The price is **right-censoring** — a capped run yields a lower bound on cost,
    not a cost — and the loudest statement of the consequence is that
    **Structured Procrastination deliberately returns the configuration with the
    longest total execution time rather than the best empirical mean, "due to
    theoretical reasons".** Under capping the mean over survivors is not an
    estimator you may use.

  **TIME, the live hazard is the CPP.** A profile compiled by running to successive
  rungs is censored wherever a rung is not reached within budget. If deep rungs are
  only reached on easy premises and the profile averages the premises that got
  there, **the profile is optimistic and increasingly so with depth** — which is
  exactly the shape that makes a saturating profile look like exhaustion. That is a
  **second, purely statistical explanation for C48's ambiguity**, independent of
  the evaluator-coarseness one. SP's rule is the fix and it is cheap: postpone a
  hard instance to the back of the queue with a **doubled** timeout; never discard
  it.

**VALUE — C64: "which knobs matter" is region-dependent, and we live in the region
where main effects are smallest.** Functional ANOVA on a random-forest surrogate
decomposes performance variance over parameter subsets, `F_U = V_U/V`. Across ten
solver/benchmark pairs: **main effects 20–88%** of total variance, **pairwise
interactions up to 45%**, computed **in seconds on already-logged runs**. But the
same scenario reads **88% on raw performance, 50% on improvement over the 25%
quantile, and 26% on improvement over the default**. Our twelve slots are already
hand-tuned — we operate in the third column. **A full-range sweep will over-state
main effects and hide exactly the interactions that bind.** Decompose over
improvement-over-default. This is a direct qualifier on d32's M79 plan to sort the
twelve slots.

**VALUE / OWNER — M87: ruling 49's provenance artifact already exists, and it is a
PATH.** Ablation analysis walks one parameter at a time from the source (the
expert default) to the target (the new setting), measuring each step; **>95% of
the performance gain** between default and configured is accounted for by that
path in the published scenarios. Three reasons it is the right artifact here: it
is exactly ruling 49's shape (a member admitted with evidence for *its own*
contribution, not the bundle's); it **falsifies bundles** — if six coefficients
change together and five contribute nothing, five members should not be admitted;
and it is `O(k²)` comparisons, **≤78 for twelve slots**, each racially cappable
per C63, on the arm-vs-arm harness that already exists.

**VALUE / SEARCH `[+]` M88 — coordinate-wise tuning is empirically near-optimal,
with a checkable licence.** Across real solvers, individual parameter responses
*and the full configuration landscapes* were **statistically indistinguishable
from uni-modal at the 95% level**, and *"optimising each hyper-parameter
independently a single time, in a random order, often yields final incumbents
statistically tied with optimal"*. That corroborates the ICM/coordinate-ascent
fallback and the one-slot-at-a-time habit — the field's answer to "isn't
coordinate-wise naïve?" is *empirically, usually not*. But it is a regularity
about solver parameters, not a theorem, and fANOVA's own 45% interaction figure is
the counterweight, so **R-6 applies**: sweep one slot at fixed others and test
uni-modality. That converts "we tune one at a time because it is easy" into "the
response is uni-modal, and here is the test".

**TIME — C65: name what the economy is. It is DYNAMIC algorithm configuration.**
The economy does not pick one setting per game; it re-decides allocation *during*
the search from the search's own progress. In this taxonomy that is not
configuration — its output is a **policy** over `(instance features I, internal
state features Q)`. And DAC's stated prerequisite (2) is that **runtime
information must be provided describing the current internal state of the target
algorithm**. Your scoped margin-column item ("needs an engine-side emitted field")
is *one element of that vector*; the general requirement is stronger and worth
stating as a prerequisite rather than an enhancement: **without `Q` there is no
policy to learn, only a configuration to pick.** DAC's own examples of `Q` —
current iteration, current restart number, current solution quality — are our
quanta spent, re-base count and incumbent margin. **d29's one index, arriving from
a sixth direction.**

**TIME — M89: `ratio = 2` now has three convergent optimality results.** d2's M5
recorded geometric tranches at ratio 2 with Zilberstein's penalty-≤4 theorem.
Structured Procrastination reaches the same constant independently for the
*configuration* problem — an overrun instance returns to its queue with a
**doubled** timeout, and the procedure is runtime-optimal up to a log factor.
Three literatures, same constant, same operation. That is the strongest provenance
class the survey has found for any of our numbers, and it should be stated in
ruling 49's own form: **not a swept value — a member whose provenance is three
convergent optimality results.**

**ALL — M91: R-4's fifth independent arrival, one layer up.** `set configuration`
is a first-class value of the AC taxonomy's `candidate output` axis, and the
multi-objective configurators return a **Pareto front over configurations** rather
than a winner. The field's own open problem is precisely ours: it notes one should
consider *"the Pareto front of the target algorithm in addition to (or instead of)
a Pareto front over configurations"* — our plan set (d33) and our member
collection (ruling 49) are different objects, and the literature says they get
conflated. Keep them separate by name.

---

**TIME (mostly) — domain 37: C8's second factor, twice implemented, in shipped
engines.** The survey's oldest open item was Russell & Wefald's `P(refinement
flips the chosen action)` — known quantity, no algorithm. Two engines compute it,
differently, and both implementations are **free**: counters over work already
done. Read at source (`timeman.cpp`, `search.cpp`) rather than from commentary.

**C66 — four integers we do not keep.** Stockfish multiplies its soft budget by
four factors, each reading a different face of "is the answer still moving":

| factor | reads | range |
|---|---|---|
| `fallingEval` | `2.30·(previous turn's average score − current best) + 1.1·(the score 4 iterations ago − current best)` | **[0.576, 1.728]** |
| `reduction` | interpolates on **`rootDepth − lastBestMoveDepth`** (iterations the incumbent has been stable), and carries `previousTimeReduction` across moves | [0.629, 1.544] |
| `bestMoveInstability` | `1.077 + 2.229 · bestMoveChanges / threads` | unbounded above |
| `highBestMoveEffort` | share of all nodes spent **under the current best root move** (75.8%→100% ⇒ 0.969→0.714) | [0.693, 0.838] |

We record **none** of them. Our greedy incumbent is the interruptibility witness
(C6), but nothing counts how long it has held, how often it flipped, whether its
value is falling, or how concentrated the spend on it is. Each is one integer in
the search loop, and **this is the only estimator of C8's factor that works before
the bounds bank is complete** — no intervals, no model, no CPP.

**And three of the four are C48's missing discriminator.** d16 asked for "the
margin at the deciding rung" to separate *search exhausted* from *evaluator too
coarse*. Incumbent stability is that discriminator's cheapest form: **a search
that has stopped changing its mind is exhausted; one that keeps flipping at the
same score is coarse.**

**Caveat that matters for us specifically:** count them **per hypothesis, not
globally**. In a simultaneous-move game a plan can be stable because the search is
confident *or* because the enemy hypothesis has not been revised — so a global
stability counter reads "stable" exactly when the market has stopped funding
revision, which is the failure mode it is meant to detect. And our incumbent is a
joint over units, so the natural generalisation of `bestMoveChanges` is the
**fraction of units whose component changed**, which is strictly more informative
at the same cost.

**C67 — a soft target and a hard ceiling, with a 3.14×–6.87× gap.** `optimumTime`
is what the engine *plans* to spend; `maximumTime` is what it *may*; `maxScale`
runs 3.1441–6.873 and `fallingEval` alone spans 3×. The design point is not "have
a cap" — it is that **the planned spend and the permitted spend are different
numbers with a large gap**. An allowance that is also the ceiling cannot spend
three times the plan on the turn that deserves it; a ceiling used as a plan
overspends on every quiet turn. Our tranche ladder currently reads as the first.
Note what sets the gap: **game state** (ply, remaining clock), not the current
search's uncertainty.

**C68 — TIME + MEASUREMENT, and this one is load-bearing for your v0 CPPs.** "snake6
saturates at 500 ms" is a statement about **the machine**. Recompiled, re-hosted or
run under different load, the same profile describes a different search, and every
"saturates at X ms" conclusion becomes unfalsifiable across hardware — fatal for a
number whose job is to price tranches. Stockfish ships the fix as an option,
`nodestime` ("nodes as time"): **denominate the budget in a deterministic work
unit**, and calibrate to the clock as one measured machine-local constant. Then the
CPP is reproducible, hence **versionable and diffable** — which is what keying it
on `evalVersion` (M48) was already reaching for — and a profile regression becomes
attributable to the search rather than the host. Ships with the necessary warning:
set the assumed rate well below real throughput or you miss the deadline.

**M92 / M93 / M94 — three shipped economy rules, each one line of code.**
  - **Pondering is funded by making the CURRENT move 25% more expensive**
    (`if (Ponder) optimumTime += optimumTime / 4`) — the engine does not *reserve*
    time for the ponder, it spends more now because the ponder will refund it.
    That is the opposite of how "fund ponder" reads naturally, and it is the
    shipped direction.
  - **A stop while pondering is not a stop**: the trigger sets `stopOnPonderhit`
    rather than halting. Free compute is spent to exhaustion because it costs
    nothing and might hit.
  - **No new rung is begun past 50% of the budget**
    (`increaseDepth = ponder || elapsed <= totalTime * 0.50`). This is C6's
    contract/interruptible distinction at the granularity of one rung: an
    abandoned rung returns nothing, so the marginal value of *starting* one is its
    value × `P(finish)`. The rule is **suspended while pondering**, because an
    unfinished ponder rung costs nothing.
  - **Bad news is worth more computation than good news, at a measured 3×.**
    `fallingEval`'s two terms are both positive when the score is *dropping* — the
    name states the intent. In our vocabulary: **the value of computation is
    asymmetric about the incumbent**, because the downside is what you can still
    avoid. The sound floor already encodes that asymmetry at the *value* layer; the
    allocation layer is symmetric. If they disagree, the economy is systematically
    under-funding the positions the evaluator is most worried about.

**SEARCH — M95: the bounds bank already computes the OTHER engine's rule, exactly.**
Lc0's "smart pruning" stops spending on moves that cannot overtake the leader given
the remaining budget — **C8's factor computed rather than estimated**, and
`backupMax`/`backupMin` make it an interval-overlap query for us. What Lc0 adds is
the two guards that make a sound rule usable, and both would be needed here:
  - **a deliberate over-prune factor**, `SmartPruningFactor` default **1.33** —
    values >1 stop *earlier than the provable condition allows*. The sound rule
    alone fires too rarely to save time; the aggressiveness is a member with its
    failure direction stated (it can stop on a move it should not have).
  - **a minimum-work floor** (`SmartPruningMinimumBatches`), added to prevent
    *"instamoves on slow backends"*. Our analogue is exact: at tranche zero the
    bounds are vacuous and the overlap test is trivially satisfiable in the wrong
    direction.

  **The composition of the two engines is the recommendation:** the exact rule
  where bounds exist, the four free counters everywhere else — including now,
  before the bank is complete.

**COMPOSITION — C69: a fitted constant is not a knob.** Fifteen SPRT-tuned
constants appear in those two files (`0.0029869`, `3.22713`, `0.46866`, `0.19404`,
`6.873`, `12.352`, `0.8097`, `2.229`, `1.077`, `0.639`, `1.712`, `75800`,
`104510`, `0.3272`, `0.4141`) and **not one is a user option**. The options are the
structural choices plus what only the deployment knows: `Ponder`, `Move Overhead`,
`nodestime`, `Threads`, `Hash`.

  > **A fitted constant is not a knob. Its value is a claim that won a test; a knob
  > is a claim nobody has made.**

  Exposing a tuned constant invites a setting that never passed the test that
  justified the number, which silently voids its provenance — ruling 49's concern
  stated as an access-control decision rather than a documentation one. The
  corollary is the useful half: **`keepQuiet: 2` and the four caps are each either
  fitted (and belong in source with their provenance) or unfitted (which is an
  admission, not a configuration).** There is no third category, and the knob bag
  currently pretends there is.
