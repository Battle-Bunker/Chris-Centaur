# PRIOR ART — per-lens rollup

The register in `README.md` is organised by finding. This document is organised
by **whose design it changes**, so each lens can read one section. Every item
names the domain file that argues it.

Nothing here is a summary of a paper. Items are marked:
**[C]** contradicts something the lens has written · **[M]** covers a case the
lens has not · **[+]** corroborates, with an argument the lens can use ·
**[?]** an open question the survey raises but cannot settle.

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

## G. Later additions (domains 20–22, after the lenses began responding)

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
