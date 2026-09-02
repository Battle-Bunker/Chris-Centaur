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

**OPERATOR-INBOUND and OPERATOR-OUTBOUND**: your prior art is **domain 39**
(`39-mixed-initiative-the-two-operator-lenses.md`), delivered in §G. Read it
together — the headline is that **you are designing one decision with three
outcomes and two thresholds**, not two designs, and neither half can be set
without the other's utilities. Also relevant to you: **d10** (the Centaur surface;
contrastive explanation; complete internally / selected externally), **d35** (why
a *safety* closure is a shield and guidance must not be), **d33** (the
non-dominated set is what you have to show, and ε is the legibility budget), and
**d15**'s ε-as-a-ledger.

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

---

**COMPOSITION / SEARCH / BELIEF / VALUE — domain 38: provenance semirings, and the
bounds bank's annotation has a name in the literature.** There is a field whose
entire subject is "propagate an annotation alongside a value through a
computation". It has a framework, a universality theorem, a worked counterexample
that is our use case, and — recently — a branch applying the machinery to **game
value computations with alternating fixed points**, which is our object rather
than an analogy. Four findings, and one of them is R-4's sixth arrival *inside*
the value backup.

**C70 — SOURCE-CHECKED, and the source turns up something sharper than the
abstract argument.** In `bounds/score.ts`, both backups are:

    ledger:      unionLedgers(justifier(children, b => b.worst, worst).ledger,
                              justifier(children, b => b.best,  best ).ledger),
    assumptions: unionAssumptions(...children.map(c => c.assumptions)),

**The two annotations on the same bound use different propagation rules.** The
ledger comes from the **justifying child** — the one that set the endpoint. The
assumptions are unioned over **every** child. So a child whose `worst` was 5 when
the max-worst came out 9 contributed *nothing to the number*, and its premises are
attached anyway. Sound — the bound is reported as more conditional than it is —
but it means **a refuted premise invalidates a strict superset of what it should**,
and `justifier` is already sitting there as the fix.

**And the defect is dormant with a scheduled activation date.**
`unionAssumptions` fast-paths through `soleGroup`, whose own comment says why:
*"The basis is identical on every branch of every price … so the union of N copies
of one canonical array is that array"*, and *"a bound with no assumptions is the
default"*. Both conditions hold **because premises are currently uniform across
branches** — and the fog programme's whole direction is *branch-dependent*
premises. At that point `soleGroup` returns `null`, the union starts doing real
work, and every bound begins accreting premises it does not depend on. **R-6's
shape with a date on it**, alongside `φ_uv ≡ 0` and the static `CloudPremise`.

**C70's framework half.** Set union on **both** operations is the literature's
named **why-provenance** semiring `(P(X), ∪, ∪, ∅, ∅)`, and the founding paper
(Green/Karvounarakis/Tannen, PODS 2007) introduces it and immediately shows what
it cannot see: two results with the *same* assumption set, where one is derivable
from `r` alone and the other from `s` alone — *"and this cannot be detected by
why-provenance. It seems that we need to know not just **which** input tuples
contribute but also **how** they contribute."* The theorem that makes this
actionable: **`N[X]` is universal for commutative semirings** — every coarser
reading (trust, confidence, plain derivability, our current set) is a *homomorphic
image* computable later. Annotating with structure is reversible; collapsing to a
set is a one-way door.

**ALL — R-13, and it is cheap and checkable.** Proposition 3.5: `q(h(R)) = h(q(R))`
for every query **iff `h` is a semiring homomorphism**. So:

  > *An annotation may be reduced before combining rather than after **exactly
  > when** the reduction is a semiring homomorphism. If it is not, the reduction
  > must be applied only at the end — reducing early silently changes the answer.*

  Two applications, the second live: it **names the reason** behind C22 (interval
  dominance sound at the leaf, unsound propagated up the deep channel — the
  "is this dominated" reduction is not a homomorphism there), and it **settles**
  whether `advisoryPrecision` may be applied per-term and then combined. For a
  `min`/`max` backup with a multiplicative precision it is **not** a homomorphism,
  so precision must be combined last or it is computed from the wrong path.

**BELIEF — C72: our premises are substantially NEGATIVE, and the machinery is known
to be inadequate for exactly that.** Grädel & Tannen's own assessment of the field
they founded: semiring provenance *"has been rather successful for **positive**
query languages … However, **it did not really offer an adequate treatment of
negation or missing information**."* Their fix is **dual-indeterminate
polynomials** — annotations over positive *and* negative tokens, quotiented by
congruences generated by products of positive and negative tokens (`x · x̄ = 0`).

  Our premises are largely negative: *the enemy queen is not at c4*, *no unit
  occupies this cell*; the conditioning ladder's C1 (item-vanish disjunction) and
  C2 (joint exclusion) are **negative provenance tokens** in the technical sense.
  The congruence is not abstraction — it is the operational statement that **a
  bound resting on both a fact and its negation is dead**, expressed *structurally
  in the annotation* rather than as a separate consistency pass someone has to
  remember to run. And this is the same disease as **C26** one layer up: the
  representation is positive-only and the content is not. A prediction follows: if
  assumptions are ever *valued* (trust, precision, ε-budget), a positive-only
  annotation will price a negatively-derived bound as though it rested on nothing.

**VALUE / SEARCH — M96: R-4's SIXTH arrival, and the first one inside our own
computation.** Evaluating the fixed-point formula that defines a game's winning
region *in a semiring of polynomials* gives *"not only the Boolean information on
who wins, but also **tells us how they win and which strategies they might use** …
information about all **absorption-dominant strategies — strategies that win with
minimal effort**."*

  R-4 has now been argued from maximality, α-vectors with dominance regions,
  contrastive explanation, the Pareto front, and the AC taxonomy's
  `set configuration` axis. This sixth is qualitatively different: **it is not a
  parallel construction in another field, it is the same computation as ours** — a
  value backup over an alternating fixed point on a game. And it says the
  non-dominated set is what you get *for free* in the right semiring, rather than
  as a second pass over the answer. **Absorption is R-4's dominance filter built
  into the algebra.** Complementary to d33's LP pipeline rather than competing:
  absorption prunes **derivations**, the LP prunes **objectives**.

**VALUE / CENTAUR — M97: the foil is a by-product too.** The same machinery's
stated application is *"determining **minimal modifications to the game** needed to
change its outcome"* — which is **C32's missing foil**, computed from the
annotation instead of by re-running the search under a counterfactual. With d33's
finding that the dominance *region* is the pruning LP's own witness, the Centaur
surface's two hardest fields now both have by-product sources, and neither needs an
explanation subsystem.

**COMPOSITION — M98, and it lowers the cost of everything above.** The obvious
objection to keeping structure is size: an expanded provenance polynomial can be
exponential. The field's answer is a **provenance circuit** — keep the annotation
as a **DAG of `+`/`×` gates with sharing**, evaluate under any valuation in linear
time, never materialise the expansion. **Our bound DAG already is that circuit**:
`backupMax`/`backupMin` are the gates and the shared sub-results R-2 warns about
are the sharing. So the fix is not "store a polynomial per bound" — it is *stop
collapsing the structure you are already building into a set at every node*. The
set is one valuation of the circuit; keep the circuit and compute the set on
demand.

**SEARCH — the bug-shape to look for.** When two derivations **tie** under
`backupMax`, the annotation must record **both**. An implementation that keeps the
argmax's annotation drops half the provenance silently — and ties are common in a
game with symmetric geometry. (This is also the mechanism behind M96's
"absorption-dominant" being *plural*.)

**The honest limit, stated by the papers themselves.** The Büchi work closes by
*"discussing limitations … and presenting questions that cannot be immediately
answered by semiring semantics"*. Provenance tells you how a result was derived
from the inputs it had; it does not tell you what the inputs should have been, and
it does not price a computation you did not do. So this answers the **bank's**
bookkeeping question and the **Centaur surface's** foil question — not the
economy's allocation question, which stays with domains 34 and 37.

---

**OPERATOR-INBOUND + OPERATOR-OUTBOUND — domain 39, and the headline is that you
are ONE decision.** Prior art for the two new lenses. It also closes **C33**
("ask the operator is a purchasable observation with no row in the economy") in a
stronger form than C33 stated.

**The construction both of you are inside (Horvitz, CHI 1999).** Four utilities
over {act, don't act} × {the operator wanted it, they didn't}, plus one belief
`p(G|E)`, give two crossing lines and a **threshold** `p*`. Add a *third* option —
**dialog** — and you get **two thresholds**, because asking when the operator did
*not* want the action is better than acting wrongly, while asking when they *did*
is worse than just acting:

  > **silence** below `p*_{A,D}` · **ask** between · **act unilaterally** above
  > `p*_{D,A}`.

**C75 — the outbound surface is missing the middle band's existence.** Today it has
"show" and "don't show". The correct structure has three regions, and the middle
band's *width* is set by how much a needless interruption costs relative to a
needless mistake. **And this sharpens d37's C69 rather than contradicting it.**
Horvitz: thresholds *"can be directly assessed by designers or users"*, and doing
so *"implies a deeper implicitly assumed expected-utility model"*. So:

  > **A number that encodes a MEASUREMENT belongs in source with its provenance. A
  > number that encodes a PREFERENCE belongs in config — and its provenance is the
  > four utilities it is a shadow of.**

  `keepQuiet: 2` and the four caps are on the first side; your thresholds are
  legitimately knobs on the second. But name the four outcomes, or the knob is a
  claim nobody has made after all.

**C73 — INBOUND: asking is a STRATEGY, not a purchase.** Scerri, Pynadath & Tambe
(JAIR 2002) replace the one-shot ask with a **transfer-of-control strategy**: a
conditional sequence of *(who decides, for how long, what to do meanwhile)*, e.g.
`H D A` — ask the human, take an action that buys time, then take control back.
Three results that bind on us:
  - **every viable strategy ends in `A`** — the agent must eventually decide, and
    the trigger is stated: when the expected cost of continued waiting exceeds the
    decision-quality difference. A design where a pending query can leave the bot
    without a move is not a strategy;
  - their diagnosis is aimed at our configuration exactly — prior work used *"rigid
    one-shot transfers of control that can result in unacceptable coordination
    failures in **multiagent** settings"* and *"ignore costs … to an agent's
    **team**"*; from the deployment, one-shot transfer in a teams-plus-human domain
    *"failed dramatically"*. **Our units act jointly**, so a stalled query costs
    **miscoordination**, not just delay;
  - **no strategy dominates** — but three Lemmas prune the space **offline** from
    three parameters we can estimate (M102): wait-cost shape (cliff-shaped, at our
    deadline), response probability (measurable from the archive), relative decision
    quality (what the evaluation programme already measures). Ship a **member
    collection** of named strategies with a selection rule, not one interaction
    model. Ruling 49's shape applied to the interaction design itself.

**C74 — INBOUND / ACTION: the third action neither lens has conceived — change the
plan to make waiting cheaper.** The `D` action is *"reordering tasks to **buy
time** to make the decision"*, a first-class action beside ask and act. In our
vocabulary: **prefer a plan whose commitment point is later**, so the operator's
answer arrives before it binds — a slider that advances two cells instead of four,
a unit that holds a fork instead of resolving it, a re-base that defers the
irreversible half. The programme has the taste for this ("keep options open") and
no lever; this is the lever, with a decision rule instead of an aesthetic.

  Two things make it concrete rather than encouraging: it turns **option value into
  a term in the interaction decision** (the consumer d22's Baldwin–Clark pricing
  lacked), and it has a **window** — *"`D`s become valueless after the deadline,
  when wait costs stop accruing"*, and a second `D` is worth less than the first
  when wait costs accelerate. **Worth exactly one application, early.**

**C76 — BOTH: every threshold moves with operator state, and we model none.**
Horvitz gives the directions explicitly: the cost of unwanted action *"diminishes
significantly with increases in the depth of a user's focus on another task"* —
which **raises** the act threshold — and the cost of inaction *"may decrease as a
user becomes more rushed"* — which **lowers** it. In this game both modifiers are
the **standing condition**, not the exception: there is a clock so the operator is
always rushed, and a board so their focus is always on some particular unit. Both
thresholds are permanently displaced from their defaults, in known directions, by
an amount nobody tracks. Per d29 this is a **premise coordinate for the interaction
decision**, and the cheapest version is two proxies the harness already sees:
**which unit last received a manual command** (focus) and **elapsed fraction of the
deadline** (rush).

**M99 — INBOUND: guidance is a MEMBER, not a SHIELD, and this is the whole design.**
d35 established our closures are **pre-decision shields**, and that a shield is not
tradeable at any weight. Guidance is the opposite case. Advice-taking systems
(Maclin & Shavlik's RATLE) compile advice somewhere *"subsequent reinforcement
learning further integrates and **refines**"* it, so wrong advice degrades the
agent rather than crippling it.

  > **A safety closure is a shield: not tradeable at any weight. Operator guidance
  > is a member: admitted with provenance, priced, overridable by evidence.**

  Concretely: guidance may **price** plans, seed an order, or open a hypothesis in
  the market — it must **never remove** plans from the admitted set. A wrong
  removal is unrecoverable and, per d38's C70, invisible downstream. A wrong price
  is recoverable by the same mechanism that prices everything else.

**M100 — OUTBOUND: "do less, but do it correctly under uncertainty."** Horvitz's
principle 8 (*scoping precision of service to match uncertainty*) is a rule about
**the granularity of what you commit to and show**, and it says granularity should
shrink as uncertainty grows: a direction rather than a cell, a role rather than a
path, the non-dominated set rather than a pick. This is **R-4's Centaur half as an
interface rule** — d33's ε is the dial, and this is the rule for setting it.

**M101 — BOTH: the overrides are labelled data and the archive already has them.**
Every operator override is a human-labelled example of a decision the bot got
wrong; every non-override on a surfaced signal is a weak positive. Three uses, all
cheap: it **fits `p*_{D,A}` instead of guessing it**; override clusters mark the
instance-space cells where the evaluator is worst (d26); and it is the **only**
signal anywhere in the programme about *what the operator actually wanted*, which
is the quantity both of you exist to serve and nothing else measures.

**The honest possibility, stated up front.** Our turn deadline may be too short for
a dialog turn at all. If so, the Lemmas point at *ask rarely, and act* — and that
is a **finding, not a failure**: it would say the inbound channel belongs
**between** turns, as standing guidance, rather than **within** one. Settle that
first, because it is the question that decides what the inbound lens is for.

---

**ALL / TIME / VALUE / SEARCH — domain 40: "deeper is better" is a hypothesis, it
has a checkable condition, and our own measurement is evidence the condition fails
where the game is decided.**

The flagship is depth. The economy exists to buy it, the CPP measures its returns,
the tranche ladder allocates it. All of that rests on an assumption nobody has
written down. There is a forty-five-year literature whose **founding result** is
that the assumption can fail.

**The result.** Beal's model — uniform branching, two-valued nodes, constant loss
proportion per level, **node values independent within a level**, depth-independent
evaluator error — gives root error that **increases with depth**. Beal's own
verdict on his own result: *"This result is disappointing."* The phenomenon is
**minimax pathology**: minimaxing *amplifies* the evaluator's error, so deeper
search produces worse decisions.

**The resolution, and it is the part that transfers.** Five groups reached it
independently: *"the pathology is usually not observed in real games because their
position values are **not independent of each other**"* — the load-bearing property
is **dependence between sibling values, the similarity of positions close to each
other**.

**C77 — our game splits on that condition, and not comfortably.**
  - **Within one unit's options**, dependence is strong: a slider's siblings differ
    by which cell it stops on, and adjacent cells have similar consequences. Benign.
  - **Across a cluster's joint plans**, dependence is weak — and the VALUE lens has
    already **measured how weak**. King-present cells: mean |residual| **1.946**;
    no-king: **0.201**. A **9.7× step**, `corr(king, residual) = +0.954` (d31 §31.5).
    A 9.7× discontinuity in value between structurally adjacent plans **is** low
    sibling dependence, in the precise sense this literature means.

  **So the wipe-closure defect is not only a pricing error — it is a pathology
  risk.** Two independent findings, one mechanism: d31's mechanism step and this
  domain's independence condition are the same property seen from two sides. And
  note *which* cells: **king-present cells are the decisive ones.** The prediction is
  not "depth might not help on quiet boards", it is **"depth is most likely to hurt
  exactly where the game is decided"**.

**C79 — TIME: C48's second horn gets a theorem instead of an anecdote.** Pearl
(1983): *to overcome the pathology, the error of the evaluation function must
decrease **exponentially** with the depth of search* — and the field's own
expectation is that *"the quality of the evaluation cannot vary enough"* for that,
which is why node-value dependence does the real work in games where depth helps.
So "evaluator too coarse for depth to bite on" is not a vague complaint; it is a
**quantitative condition with a rate**, and a flattening profile is its observable
signature. Combined with d37's C66, the discriminator set is now three-way:

  | observation | diagnosis |
  |---|---|
  | incumbent stopped changing | search exhausted |
  | incumbent keeps flipping at a stable score | evaluator coarse |
  | residual not falling with depth | evaluator coarse, **rate measured** |

**M103 — the test is cheaper than the work it informs and runs on the archive.**
Two forms, both using data already held:
  1. **Measure sibling dependence** — correlate structurally adjacent plans'
     evaluations, **stratified by the mechanism indicators d31 already derived**
     (king-present, wipe-reachable, contested). Low within-stratum correlation is
     the pathology precondition, and it predicts *which cells* depth should hurt on.
  2. **Measure the decision, not the evaluation** — re-run archived positions at
     increasing rungs and record whether the chosen plan's **realised outcome**
     improves, *per cell*. Pathology is a claim about decision quality; a root-value
     comparison cannot see it.

  Either answer is worth having. Depth helps everywhere ⟹ this domain is a note and
  the flagship is justified. Depth helps on some strata and hurts on others ⟹ **the
  spend rule should be conditioned on the stratum**, which is precisely what the
  CPP's premise coordinate exists to do.

**C78 — SEARCH/REDUCTION: MaxN has a pathology theorem named after it.** Mutchler
(1991) extends Nau's theorem to **MaxN**, the multi-player backup — which is one of
REDUCTION's three members (R-1). Not a disqualification: it is **the failure
direction ruling 49 requires a member to carry**. Mechanism is intelligible — in a
multi-player backup a node's value depends on which opponent is assumed to be
maximising, so sibling values decouple faster than in the two-player case.
Practical form: if a depth sweep shows depth helping under `paranoid` and not under
`MaxN`, that is documented behaviour, not noise, and the member table should say so.

**M104 — SEARCH: a point in our favour, measurable today, and a THIRD argument
against the caps.** Michon (1983): *"game trees with uniform branching factor tend
to be pathological, while game trees with, for example, geometrically distributed
branching factor do not"* — with the caveat that nobody knows which family real
games fall in. **Ours is extremely non-uniform** (~71 options for a queen, 3 for a
trail unit) and the per-unit option-count distribution is a by-product of admission,
so the cheapest thing in this domain is to plot it. **But `sliderCandidateCap: 4`
and `enumCandidateCap: 8` make branching MORE uniform.** If non-uniformity is what
protects against pathology, the caps are removing the protection — a third argument
against enumerate-then-cap, beside C2's adaptivity requirement and M39's
progressive widening.

**M105 — VALUE: this supplies C24's mechanism and says where the evaluator work
pays.** "A better evaluation always beats a deeper search in this family" (the Tron
winner) is pathology stated as tournament experience: minimax does not merely
*inherit* evaluator error, it **selects for it**, and the selection strengthens with
depth wherever sibling dependence is weak. The actionable half is the localisation —
evaluator improvement has its super-linear payoff **in the low-dependence strata**,
which are the wipe-closure cells, which are the cells the mechanism indicator already
flags. **Fixing the wipe closure is simultaneously a pricing fix, a coverage fix
(M77) and a depth fix.**

**M106 — switching search family does not dissolve it.** *"UCT is indeed
susceptible to pathological behavior in a range of games"* (arXiv:2212.05208). The
question is about the interaction between an inexact evaluator and a selection
operator, and every candidate search family has one.

**The mitigation we actually have, and it is worth knowing.** Pathology is a
statement about a **heuristic value propagated through `min`/`max`**. A **sound
bound narrowing is immune to it** — a bound is sound regardless of evaluator noise.
So the threat is to the **advised** reading and not the **sound** one: a structural
immunity plain minimax lacks, and one more reason the two readings must stay
separate. The other real counter-argument, from the literature itself: Luštrek,
Gams & Bratko show that **real-valued** position values (rather than win/loss) are
enough to remove the pathology on their own — which is why C77 scopes the worry to
the **discontinuous** cells, where exactly that real-valued smoothness fails.

---

**SEARCH / REDUCTION / VALUE — domain 41: multi-player search, the pruning wall,
and the precondition our currency already supplies.** Our game has three teams and
REDUCTION's member list is `{paranoid, MaxN, share-weighted asymmetric fold}` —
the two canonical algorithms of a literature nobody had surveyed. What is known
about them is sharp, and it is bad news for one member on **three independent
axes**.

**C80 — COMPOSITION/SEARCH: C22 is a theorem, not a bug.** Korf (1991): given an
upper bound on the *sum* of players' evaluations and a lower bound on each,
**shallow** alpha-beta pruning is possible in MaxN — **but deep pruning is not**.
Deep pruning in MaxN is not hard, it is *unsound*: a bound on my component says
nothing about the component the intervening player is maximising.

  So d6's C22 — *"interval dominance is sound at the leaf and unsound propagated up
  the deep channel"* — is not an artifact of our bound arithmetic. **It is the
  correct behaviour of the algorithm the REDUCTION joint selected.** Stop looking
  for the arithmetic that would make deep propagation sound; either accept
  shallow-only as the licensed regime, or change the member.

  **And the cost is not marginal.** Best case under shallow pruning is
  `(1 + √(4b−3))/2 ≈ √b`, but *"an average case model predicts that even under
  shallow pruning, the asymptotic branching factor will be **b**"* — no asymptotic
  gain at all — which *"compares poorly with the 2-player best-case asymptotic
  branching factor of √b, which can very nearly be achieved in two-player games"*.
  Roughly **squaring the node count for a given depth**, with the `512` joint cap
  already binding on 5–6-unit components (d17), is the difference between the cap
  binding sometimes and binding always.

**C81 — REDUCTION: the member whose model is WRONG wins, and for our own reason.**
Sturtevant's measurement: *"paranoid widely outperforms maxn in Chinese Checkers,
by a lesser amount in Hearts, and they are evenly matched in Spades."* Paranoid
assumes all opponents conspire against you — which is **false** — and wins anyway,
because the pruning it enables buys depth and the depth is worth more than the
modelling error.

  That reframes the member choice: **not "which model of the opponents is truer"
  but "which model buys more depth per unit of modelling error"** — which is the
  discipline the sound floor already embodies at the value layer ("a pessimistic
  statement you can compute cheaply beats an accurate one you cannot"), now
  governing the search operator, with a measurement behind it.

  **The gap is domain-dependent** (wide / small / nil across the three games), so
  this is a member selection with a condition, not a verdict. The condition is
  roughly *how far the third team's interests diverge from adversarial* — and it is
  **measurable on the archive**: does third-team behaviour correlate with harming
  the leader?

**C82 — REDUCTION: the kingmaker, and a third independent argument for paranoid.**
*"A player's move can determine another player's victory without affecting their
own standing"* — so no score-maximising model predicts them, and *"opponent
modeling becomes crucial"* but is *"largely unsolved"*.

  The programme already has the symptom: **the three-team balance bug**, which R-1
  reframed as a member selection. The reframing is right but incomplete —
  **neither canonical member can express the kingmaker case, and only one fails
  safely.** MaxN assumes the third team maximises its own score; in a kingmaker
  position that score is unaffected either way, so **MaxN's prediction is arbitrary
  — it falls to whatever the tie-break does**. Paranoid assumes the third team is
  against us, which is at least *defined*, *falsifiable*, and *safe*.

**M107 — VALUE/SEARCH: the share currency supplies the precondition multi-player
pruning REQUIRES, and nobody has said so.** Korf's shallow-pruning result is
conditional on **an upper bound on the sum of the players' evaluations** and **a
lower bound on each individual evaluation**. In a general multi-player game those
are extra assumptions. **In the share currency they are identities**:
`sharePar = K·w/W` is non-negative and sums to a constant by construction.

  > **Pricing in shares is not only an accounting convenience. It is the condition
  > under which multi-player pruning is licensed at all.** An unnormalised
  > evaluation has no sum bound, and without a sum bound MaxN cannot be pruned even
  > shallowly.

  Two follow-ons. It **upgrades the currency from "inert accounting"** (d32's
  verdict, correct on its own terms) to *enabling the search* — because it acts on
  **what gets computed** rather than on the ordering of what is computed, which is
  a category d32's accounting/policy test does not have. And it makes constant-sum
  a property to **preserve deliberately**: any future term that breaks the sum (a
  bonus not taken from another team's share; an unnormalised safety penalty)
  silently removes the pruning licence and nothing would report it. **R-6: assert
  `Σ shares = K`.**

**M108 — SEARCH: speculative pruning is a member with a stated failure direction,
and our game qualifies.** *"The first multi-player pruning algorithm that can prune
any **constant-sum** multi-player game"* — and per M107 ours is constant-sum in the
fold's own currency. It prunes branches that are only *probably* irrelevant, so it
can return a wrong answer, with a speculation parameter as the dial. Ruling 49's
shape exactly. And it fits this architecture unusually well because the bank
already separates a **sound** reading from an **advised** one: **speculative
pruning belongs in the advised path, and the sound path keeps shallow-only.** The
two-reading split is what makes an unsound-but-fast pruner safe to adopt — another
payoff from a decision made for other reasons.

**M109 — SEARCH: the member choice is not a module, it is the min-node operator.**
`backupMin` over the enemies **jointly** is paranoid; a per-enemy maximisation is
MaxN. So REDUCTION's member selection cannot be layered on top of the bounds bank
— it *is* the definition of the min-node operator. The **pruning licence** (C80),
**deep-propagation soundness** (C80), **kingmaker behaviour** (C82) and **pathology
exposure** (d40's C78) all follow from which operator sits there, and none of them
is stated where that operator is written. **One comment at `backupMin` naming which
member it implements and what that licenses would carry four separate results** —
the highest-leverage R-6 assertion the survey has found.

**The honest scoping.** MaxN and paranoid are defined on *alternating-move* trees
and our game is simultaneous, so the min node is a matrix game (d1's C1) and the
pruning *theorems* need re-derivation rather than citation. But the two results
that matter survive the translation because they are about the structure of the
**value**, not the move order: a bound on my component still says nothing about the
component another player maximises (C80), and a third player with no stake still
has undefined behaviour (C82). **And the cheap measurement settles the rest**:
count nodes per rung under the two operators on the existing archive — it resolves
whether the asymptotic gap bites at our depths with three players, and it is an
afternoon.

---

**SEARCH / COMPOSITION / BELIEF — domain 42: abstract interpretation. The bounds
bank has a formal identity, and its domain is the field's canonical weak one.**

`[worst, best]` per option, propagated through `backupMax`/`backupMin`, joined by
`tighten`, relaxed by `BOUND_EPSILON`, conditionally tightened by `withNarrowing`
— every one of those is a named object in a fifty-year-old framework with theorems
attached. With d38 (the annotation is a why-provenance semiring) and d41 (the min
node is a multi-player backup), **the bank now has three formal identities and had
been given none.**

**The ladder, which is the frame.** *"An abstract domain … together with a fixed
set of operators and transfer functions (union, intersection, widening,
assignment, guard)."* The numeric domains:

| domain | invariants | cost |
|---|---|---|
| **intervals** | `v ∈ [c₁,c₂]` | *"very efficient — linear memory and time cost — **but not very precise**"* |
| **octagons** | `±x ± y ≤ c` | **O(n²) memory, O(n³) time** |
| **polyhedra** | `α₁v₁ + … ≤ c` | *"much more precise"*, exponential |

*"The octagon domain is in between the well-known fast but imprecise interval
domain and the costly polyhedron domain."*

**C83 — we are on the bottom rung, and the value model above it is RELATIONAL.**
`cluster-enum.ts` computes `Ṽ(x) = Σφ_u(x_u) + ½Σφ_uv(x_u,x_v)` — explicitly
**pairwise**. The bound travelling with it is `[worst,best]` per option —
**non-relational by construction**. So:

  > **The value model is pairwise; the bound model cannot express a pair.** The
  > bank is structurally unable to represent the couplings the search is organised
  > around.

  And the octagon's constraint form is exactly that shape: `±x ± y ≤ c` reads as
  *"unit A's gain plus unit B's gain is at most `c`"* (they contest the same cells)
  or *"A's share minus B's share is at most `c`"*. **Octagons are the abstract
  domain of a pairwise factor graph.** Scoping that matters: apply them **per
  unit-contribution, not per plan** — 5 units is `5³ = 125`, but 5 units × 8
  candidates is `40³ = 64,000`, worse than the enumeration. The cheap granularity
  is the one `φ_uv` already uses. **Trigger to look for:** bounds much looser than
  the surrogate's own pairwise term implies — that is d23's dependency problem, and
  at that point it is fixable *by construction* rather than by tuning.

**C84 — `tighten` is the DIRECT product, and we already hold both halves of the
textbook case where the REDUCED product is strictly stronger.** The bank's own
words: *"two INDEPENDENT sound statements about the SAME quantity, joined into the
tightest one: floor rises to the better floor, ceiling falls to the better
ceiling."* That is the direct product — each domain's answer kept as-is. The
**reduced product** lets each domain *refine* the other before the meet, and is
strictly more precise.

  The canonical illustration is **intervals × congruences** — and this is not an
  analogy, it is our case: **d7's V-3 checkerboard parity bound is a congruence**
  (the reachable count has a known parity) and **the cell-count bound is an
  interval**. Direct product of `[3,5]` with "even" reports `[3,5]`. **Reduced
  product reports `[4,4]`.** We hold both operands and compose them with the weaker
  operator.

  Generalised: **every time the bank gains a second, structurally different bound**
  (parity, a conservation identity, a monotonicity), the question is not only *is
  it tighter* but **does it let the other bounds get tighter**. `tighten`'s
  same-basis refusal is exactly right for soundness and says nothing about this —
  the reduction step is a separate operation the bank does not have.

**C85 — TIME/SEARCH: `BOUND_EPSILON` is a WIDENING, and a widening exists for one
reason: to guarantee a fixpoint iteration terminates.** Our bounds are refined
iteratively — tranches within a turn, re-base and carry across turns. Two questions
the framework forces and the design has not asked:
  - **does the refinement iteration reach a fixpoint?** Within a turn, with a finite
    option set and monotone tightening, yes. **Across turns it is a genuine loop and
    nobody has argued it terminates.**
  - **is `BOUND_EPSILON` doing widening's job accidentally?** If the cross-turn loop
    converges only because each pass relaxes by an epsilon, then a constant
    introduced as a *rounding fix* is load-bearing for **termination**. That is R-6
    in its purest form: a correctness property resting on a constant introduced for
    an unrelated reason.

  Also a **C11-style terminology collision**: `withNarrowing` does not do what
  narrowing does. In the framework, narrowing *recovers precision that widening
  discarded*; ours *conditionally tightens and records the condition as an
  assumption*. Both recover precision, which is why the name is tempting — but
  anyone reading both expects the fixpoint partner of widening. Rename or document,
  as C11 recommends for "dilation".

**M110 — BELIEF/COMPOSITION: trace partitioning is C37's fifth coordinate, and it
makes the coordinate CHEAPER than C37 implied.** Static analysis has the same
defect (merging abstract states where paths join loses what the path knew) and the
same fix under its own name. Two refinements transfer:
  - **the coordinate must be a bounded abstraction of the history, not the
    history.** Partitioning by the full trace is unbounded and useless; the entire
    engineering content is choosing a small abstraction that separates the cases
    that matter. C37 asks for "reach/range"; this says *which* bounded abstraction
    is a first-class design choice with a literature behind it.
  - **partitioning is parameterised per site.** You partition where precision is
    needed and merge where it is not — so **carry the range coordinate where the
    memo is hot and the histories differ, and merge elsewhere**, rather than adding
    a coordinate to every key. That is a much cheaper answer than C37 implied.

  This is the **third independent field** to arrive at C37's conclusion
  (imperfect-information decomposition; provenance's *which inputs and how*; static
  analysis) — worth having, because C37 asks for a change to a cache key and cache
  keys get defended on performance grounds.

**M111 — ALL: soundness is a PER-OPERATOR obligation, and our operator set is
five.** The framework's discipline: state the abstraction once, then discharge one
obligation per abstract operator (the abstract function over-approximates the
concrete one). **Soundness of every composite then follows** — the composite never
has to be argued about. Our bank argues soundness *per site, in prose, in module
headers*, which is exactly the pattern R-6 names as the disease (*"prose does not
fail"*). The fix is unusually cheap here because the operator set is tiny:
`backupMax`, `backupMin`, `tighten`, the epsilon relaxation, `withNarrowing`.
**Five obligations, stated once, cover every composite bound in the system.**

  And it interacts usefully with d41's M109: **the min-node operator's obligation is
  where the REDUCTION member's identity becomes a soundness statement**, so writing
  the five obligations produces the assertion M109 asks for as a by-product.

---

**COMPOSITION + OPERATOR — domain 43: response to the index inversion**
(`design/joints-composition` @ `373916d`). Four responses: one concession, two
cheap additions to a table that is about to be encoded **as data** (X1) and is
therefore far cheaper to get right now, and one rider that is correct and
under-powered.

**[+] The product-not-lattice correction is right, better than my framing, and
standard.** Domain 29 argued seven named things are one coordinate system and gave
three tests for it; it never said what *algebra* the object has, and by not saying
it implied a uniform one. Your table is the correction, and your own reading —
*"a design that assumed uniform operations would, for instance, try to widen
`botId`"* — is exactly the failure my under-specification invited. The construction
is standard: **a product of lattices with componentwise operations is the normal
way to build a composite abstract domain**, and your `config.bot/codeRef/seat` row
("equality-only: you cannot average two bots") is a **flat lattice**, the standard
component for precisely that. And your consequence 2 — generate the ECONOMY lever
menu **from the table** rather than by hand, which is `voc.ts`'s actual defect — is
the one-index claim producing a bug fix, the strongest evidence for it there is.

**C86 — the table is missing a TERMINATION column, and only three rows carry it.**
A **widening** exists in this framework for exactly one reason: to guarantee a
fixpoint iteration terminates in a domain with **infinite ascending chains**. Where
the lattice has finite height, none is needed and adding one only loses precision.
So the column is *"does this coordinate admit infinite ascending chains?"* and the
answer is non-uniform, which is your own point applied to an operation the table
does not yet list:

| coordinate | height | widening? |
|---|---|---|
| `config.*` | flat / finite | **no** — adding one is a category error |
| `observable.horizon` | finite (bounded by the deepest rung) | **no** |
| `support.model`, `support.replies` | finite per turn | **no within a turn** |
| `observable.provenance` | grows with admission trace / conditioning depth | **yes, if unbounded across turns** |
| `measure.range` | histories accumulate | **yes** |
| the **value interval** the index carries | reals | **yes** |

  Two consequences, both cheap now and expensive later. (1) The termination
  obligation is **per-coordinate and small** — three rows, each discharged by naming
  a bound or a widening operator. (2) **`BOUND_RELATIVE_EPSILON` is about to be
  promoted**: Law T's implementation *"weaken[s] to the midpoint within tolerance"*,
  and **X4 hoists `tighten` out of the bank into the index module** — so a constant
  introduced in the bank as a *rounding* fix becomes a shared operator of the
  general machinery, still undocumented as the widening it is. **The moment to write
  down what it guarantees is the moment it is hoisted.**

**C87 — Law T specifies the DIRECT product; the REDUCED product is strictly
stronger, and we hold the textbook instance.** `lo = max(a.lo, b.lo)`,
`hi = min(a.hi, b.hi)` is componentwise meet — the **direct** product, each bound
keeping its own answer. The **reduced** product lets each domain *refine the other
before the meet* and is strictly more precise. The canonical illustration is
intervals × congruences — and that is **ours, with both operands in hand**: d7's
**V-3 checkerboard parity bound** is a congruence (the reachable count has a known
parity), the **cell-count bound** is an interval.

  - Law T as specified: `[3,5]` ∧ "even" → **`[3,5]`**
  - reduced product: **`[4,4]`**

  So Law T is correct and *incomplete*: values at an equal index compose to a
  tighter bound, but the composition it specifies is not the tightest sound one when
  the two values come from **structurally different bound families**.

  **X4 is the moment**, because it fixes `tighten`'s signature for every caller:
  decide now whether it is a binary operation on two intervals or a **dispatch over
  the pair of bound families**. Minimal version costs almost nothing — keep the
  bound's *family* beside its interval and let `tighten` consult a small reduction
  table, empty except for `interval × congruence`. **Your two guards survive
  unchanged**: sound-channel-only and non-transitivity across a widening are
  properties of the *index*, not of the bound family.

**[+] Law H′ is the framework's `join`, and the H / H′ split is the framework's
split.** The sound combination of two abstract states is their least upper bound —
in a numeric domain, the hull. An **intersection** is sound only when both
abstractions describe the **same concrete quantity**, which is exactly what your
kill-one-lose-two counterexample violates. And the *informative* combination
requires a **declared relation** between the two quantities — which is Law H. So:
**no declared relation ⟹ hull; declared relation ⟹ a transfer function through the
relation.** Two cases, one framework, correctly split. Worth recording so H′ stops
being re-litigated after four rounds — and your *"the vacuity is the point"* is the
framework's own reason for insisting the abstraction be stated.

**C88 — OPERATOR/MEASUREMENT: the ratification rider (§7.2) is right, and it
detects without correcting.** The hazard you name — *"the bot surfaces an option, a
human ratifies it, and the outcome is then counted as evidence for the term that
surfaced it"* — is **closed-loop feedback / presentation bias**, the central
methodological problem of every deployed recommender and ranker. What that
literature adds:

  - **stratification** answers *"is this corpus contaminated?"* — your rider, and
    the right first move;
  - **correction needs the exposure probability**: inverse propensity scoring
    weights each outcome by `1/P(surfaced)` to recover what would have happened
    under uniform exposure. That is a requirement on **the surfacing code to log its
    probability**, not on the fit;
  - **identification needs randomisation**: IPS is undefined where `P(surfaced) = 0`
    — the options never shown — so a **small randomised holdout** (surface nothing,
    or a random admissible option, and log it as a holdout) is the only source of
    unprompted rows once the surface exists.

  **The timing consequence is the sharp one.** Your rider refuses a fit that uses
  only caused rows. Once the surface ships, **almost every row becomes a caused
  row**, so the refusal will bind on nearly everything unless a supply of uncaused
  rows is deliberately maintained. **The holdout is that supply, and it has to be
  designed in with the surface rather than added when the refusal starts firing.**
  Keep your closing distinction verbatim: ratification is evidence about *the
  operator's preferences*, not about *the option's quality*.

**A correction I owe (d39's M101).** I told the operator lenses that overrides are
labelled data for fitting the ask/act threshold. That is subject to exactly this
hazard: an override is only observable on a **surfaced** item, so the override
corpus is conditioned on the surfacing policy and fitting `p*_{D,A}` on it without
the exposure probability **re-fits the threshold to itself**. **M101 stands only
with the propensity log and the holdout attached** — the same two instruments the
rider needs. Build them once, for both.

---

**OPERATOR-INBOUND + OPERATOR-OUTBOUND — domain 44: automation bias, and the
counterweight d39 owes you.** Domain 10 argued for the Centaur surface and d39 gave
you its decision theory; both treat a better advisor as straightforwardly better.
A large empirical literature says the failure modes of a decision aid **grow with
the operator's trust in it** — they are measured, they appear in experts, and they
**cannot be trained away**.

**C89 — the surface's damage scales with its QUALITY, and nothing in the design has
a term for it.** Automation bias produces two error kinds when the aid is
imperfect:
  - **commission** — the operator follows the advice *against information they
    themselves hold*. Reviewed rate: **in 5.2% of prescribing cases, correct
    answers were switched to incorrect after the system's advice**, mediated by
    trust, decision confidence, task difficulty, and (inversely) experience;
  - **omission** — the operator misses what the aid did not flag, because its
    silence has become a substitute for looking.

  Both are mediated by trust, and **trust is earned by accuracy**, so the surface's
  net value is **not monotone in the advisor's quality**: there is a regime where a
  good advisor makes the pair worse than the human alone on the cases where it is
  wrong. Two concrete consequences: the **omission channel is invisible by
  construction** (nothing logs a non-surfacing), and **C88's randomised holdout is
  the only instrument that can see it** — so that one instrument now has **three
  purposes: propensity correction, threshold identification, omission detection**.
  The commission channel has a cheap proxy: a ratified surfaced option whose
  realised outcome is worse than the operator's own prior pattern in that cell.

**C90 — OUTBOUND: the ask threshold is a PORTFOLIO constraint, not a per-decision
optimum.** Horvitz's `p*_{A,D}` optimises *this* interaction from four utilities.
The cry-wolf result says the channel's effectiveness is a property of the **set**
surfaced: **a 20% false-alarm rate with PPV 0.3 caused operators to ignore about
HALF of the TRUE alarms on the difficult targets** — the cases the surface exists
for.

  So lowering the threshold does not trade "a few needless interruptions" for "a
  few more catches". It **lowers the surfaced set's PPV, degrading the response to
  the alarms that matter**, and the cost lands on *future* interactions — where a
  per-decision expected-utility calculation is structurally unable to see it,
  because the loss is not in `u(A,¬G)` but in the next decision's
  `p(operator acts | we signal)`.

  > **Set the threshold so the surfaced set's positive predictive value stays above
  > a floor; optimise the utilities within that constraint.**

  PPV is measurable over a window from ratification and override rates, so this is
  **the outbound lens's first hard acceptance criterion**. It sharpens d39's C75 in
  the direction that matters: the middle band's width is not free to be set from
  four assessed utilities alone. And **`disuse` is the endgame if it is got wrong**
  — an over-alerting surface is not merely ignored, it is **switched off**, and then
  the whole Centaur direction is unavailable however good the advisor becomes.

**C91 — OUTBOUND: compliance and reliance are two channels with two causes, and the
design has one word.** *"False alarms tend to affect operator **compliance**,
whereas misses tend to affect operator **reliance**."*
  - **compliance** = acting when we signal — damaged by **false alarms**;
  - **reliance** = trusting our **silence** — damaged by **misses**.

  In the three-region structure **the silent region is a signal too** ("nothing here
  worth your attention"), and its failures have a different cause and a different
  victim. So you need **two acceptance criteria**, and only one is currently
  conceivable: the surfaced region judged by **PPV** (from ratifications), the
  silent region judged by **the miss rate inside the silence** — which nothing
  observes and only the holdout can estimate. **A single "trust" or "confidence"
  number cannot carry both**: raising the threshold improves compliance and worsens
  reliance, and that trade *is* the content of the middle band's width.

**M112 — INBOUND: intermediate automation preserves the take-back C73 makes
mandatory, and it is M100's THIRD independent argument.** Endsley & Kiris: *"the
out-of-the-loop performance problem was significantly greater under **full**
automation than under **intermediate** levels"*, and at lower levels *"subjects were
more able to assume manual control when needed."* Composed with C73:

  > **The strategy must end in take-back by the agent, and the operator's ability to
  > take back is a decreasing function of how much was automated in between.** A
  > design that automates fully in order to be helpful degrades the very capability
  > its fallback depends on.

  And M100 ("do less, but do it correctly under uncertainty" — a direction not a
  cell, a role not a path) was argued from R-4 and from Horvitz's principle 8; this
  adds that the coarser commitment is **also an intermediate level of automation**,
  which is what keeps the operator able to take over. C74's buy-time action is one
  too, by construction — it *defers* commitment rather than making it. **The same
  design move now satisfies three independent constraints**, which is the strongest
  form of evidence this survey has produced for any recommendation.

**M113 — BOTH: complacency's precondition is our standing condition, and C76's
coordinate already covers it.** Three properties make it a constraint rather than a
caution: it *"occurs under conditions of **multiple-task load**"*; it is *"found in
both naive and expert participants"*; and it *"cannot be overcome with simple
practice"*. So **"the operator will learn to check" is not an available
mitigation**, and "our operator is skilled" is not an escape. Our operator steers
multiple units against a clock — the precondition by definition. **And C76's two
proposed proxies — which unit last received a manual command (focus), elapsed
fraction of the deadline (rush) — are exactly the complacency preconditions**, so
one operator-state coordinate serves both the threshold displacement and the
complacency risk, and is cheaper than either finding implied alone.

**The honest balance, stated because the rest reads as a warning.** Endsley &
Kiris's failures are failures of **full** automation, and a Centaur surface is the
intermediate level their result *recommends*. **The programme is on the right side
of this literature's main finding**; everything above is about how to stay there.
Two scoping notes: most of this work studies passive monitoring rather than an
active collaborator, which weakens the vigilance read-across but **strengthens** the
load-driven complacency one (an active player has more attentional competition, not
less); and the 5.2% is from clinical prescribing — cite it as evidence the effect is
real and measurable, not as a rate to expect.

---

**TIME / SEARCH / VALUE — domain 45: real-time heuristic search, and pathology's
third cause is our COMMITMENT RULE.** d40 asked whether depth helps. This is the
same question in the family whose defining constraint is ours — *a constant bound
on planning per move, act before you have finished thinking, repeatedly, carrying
what you learned*. The pathology has been measured directly and **decomposed into
three causes**, and one of them is not about the evaluator at all.

**The headline.** Percentage of problems on which a **deeper** lookahead produced a
**worse** result:

| experiment | pathological |
|---|---|
| **on-policy** (walk the path you plan, updating as you go) | **57.7%** |
| **off-policy** (no learning) | **4.3%** |

**C92 — the dominant cause is ON-POLICY LEARNING, and our architecture is
on-policy by design.** A factor of thirteen, the largest effect in the domain. The
bounds carry, ADVANCE carries, attention carries, the market carries its state, the
memo persists — **every one of those is learning concentrated on the trajectory the
agent actually took**, and a different rung would have taken a different trajectory
and learned different things. So d40's C77 (which needs sibling-value independence)
is **not the only route in**: this is a second, mechanically different route that
requires *nothing* about our evaluator's error structure, and it is the route the
design's central efficiency claim is most exposed to. The mechanism is quantified
and transfers: **the volume of updates falls from 4.1 at `d=1` to 1.4 at `d=10`**,
so comparing rungs compares two different amounts of **accumulated learning**, not
two amounts of search. (Removing learning from the error measure drops pathology
57.7% → 20.2%.)

**C93 — the third cause IS our commitment rule, and it says the CPP is comparing
the wrong thing.** This one is arithmetic, not psychology:

  > a depth-`d` search performed **every `d` moves** generates `off(d)/d` states
  > per move — so **deeper lookahead with longer commitment is the same compute
  > rearranged, not more compute.**

  Their control experiment is decisive: **searching every move instead of every `d`
  moves cut pathology from 57.7% to 13.1%**, and the node counts show why — about 8
  at `d=1` in every condition, but at `d=10`, off-policy and search-every-move reach
  **~1,550** while basic on-policy reaches only **146.3**. Much of "deeper is worse"
  was **"deeper was given the same budget spread thinner"**.

  **We have exactly this structure**: the re-base window, the commitment horizon and
  ADVANCE all decide how many turns a plan is committed for, and longer commitment
  with a deeper search *is* the on-policy arrangement. So:

  > **The CPP must compare rungs at equal TOTAL WORK across the committed span, not
  > at equal per-decision depth.** A profile showing deeper rungs saturating may be
  > showing that deeper rungs are re-planned less often — an artifact of the
  > commitment rule, not a fact about the search.

  **This is a second, independent argument for C68's work-unit denominator**,
  reached from a completely different direction: C68 said wall-clock is
  machine-dependent; this says per-decision depth is commitment-dependent. **One fix
  answers both**, and two independent arguments for one cheap change is the
  strongest case the survey can make.

**C94 — TIME/OWNER: the best FIXED depth was 1, and per-instance selection was
worth 38%.**

| policy | average path length |
|---|---|
| best **fixed** depth (which was **`d = 1`**) | **175.4** |
| optimal depth **per problem** | **107.9** |
| optimal depth **per move** | 113.3 — *and* nodes/move fall **59.3 → 34.0** |

  Three readings. **(a) "Buy depth" may be the wrong verb**: on this benchmark the
  best *constant* depth was the shallowest available and the entire benefit came
  from **varying** it by instance — which is what the CPP's premise conditioning is
  for and what a single saturation point cannot express. **(b) That 38% is a
  VBS−SBS gap, for depth** — d14's C42 instrument pointed at a new axis, with a
  published value for a comparable problem class, and **measurable on our archive**:
  replay each decision at every rung, take the per-decision best, compare against
  the best single rung. Large ⟹ the conditioning is where the value is; small ⟹ a
  fixed rung is fine and the allocation machinery is overhead. Either answer
  redirects real work. **(c) The adaptive policy was CHEAPER as well as better** —
  the shape the economy hopes for, with evidence for the first time.

**M114 — VALUE/SEARCH: we already hold a depression map, computed for another
purpose.** A **heuristic depression** is *"a bounded area of the search space in
which the heuristic function is inaccurate compared to the actual cost"*, in which
an LRTA*-style agent *"easily become[s] trapped … since the heuristic values of
their states may need to be updated multiple times"*. **d31 §31.5's king-present
cells — mean |residual| 1.946 against 0.201, `corr(king, residual) = +0.954` — are
exactly that**, measured and named for a different reason.

  The literature's response is a **behaviour**, not an evaluator fix:
  `mark-and-avoid` (prefer plans that do not enter the depression) and
  `move-to-border` (if inside, head for the edge rather than re-deriving in place).
  Two readings held apart: defensible as an **interim** measure while the wipe
  closure is unfixed — but **avoiding the cells where we evaluate badly means
  avoiding the cells where the game is decided** (d40's C77), so **mark-and-avoid on
  a decisive region is a policy, not a search heuristic**, and belongs in ACTION
  with a stated cost rather than quietly in the search.

**M115 — TIME: state abstraction makes per-instance depth selection affordable, and
it is the instance space we already have.** Computing the optimal depth for every
state pair is infeasible (7.6 × 10⁷ pairs on an 8,743-state map); computing it per
**abstract** state recovers most of the benefit at **0.004% of state pairs**. Our
abstraction is **the cell** (d26), already the CPP's key — so C94(b) reduces to
**one optimal-rung value per cell**: the CPP with one more column, on a key that
exists.

**Scoping.** Single-agent path-finding has no opponent and an admissible initial
heuristic, so the **depression** results are suggestive rather than direct. But the
**learning** cause (C92) and the **compute-normalisation** cause (C93) are about the
agent's own update and budget structure, independent of any adversary, and they
transfer. And `d = 1` being the best fixed depth is a property of their benchmark —
**the transferable claim is the GAP between best-fixed and per-instance-optimal**,
which is why C94 says measure ours rather than adopt theirs.

---

**ALL (R-14) + BELIEF + VALUE — domain 46: determinization, and the one parameter
that keeps reappearing.** d12 said decomposition under imperfect information is
provably unsound. This is the sibling question: what happens when you search a
hidden-information game by **conditioning on a concrete world and searching it as
if it were observed** — which is what the hypothesis market does.

**The two named errors.** *Strategy fusion*: the search *"incorrectly believes it
can use a different strategy in each world, whereas in reality there are
information sets which consist of multiple perfect-information scenarios … a player
cannot distinguish between these situations and must choose the same strategy in
each one."* *Non-locality*: under perfect information a node's value is a function
only of its subtree; under imperfect information it is not, so locally optimal
moves can be globally inferior.

**And then the move that makes it a design tool.** Long et al. measure **three
elementary properties that probabilistically give rise to those errors**, and note
*"all of these properties can easily be measured in real game trees"*:
  - **leaf correlation `lc`** — *"the probability all sibling, terminal nodes have
    the same payoff value"*;
  - **bias `b`** — how much the game favours one side;
  - **disambiguation factor `df`** — *"how quickly the number of nodes in a
    player's information set shrinks with regard to the depth of the tree"*.

**R-14 — ALL. `lc` is a quantity this survey has now met FOUR times under four
names.**

| domain | field | the same condition, in that field's words |
|---|---|---|
| **40** | minimax pathology | Beal's assumption 4 (*node values within a level are independent*); the resolution five groups reached: *"position values are not independent of each other"* |
| **45** | real-time heuristic search | the residue after learning and compute-normalisation, driven by the heuristic's error over neighbouring states |
| **46** | determinization | **leaf correlation `lc`** |
| **31 §31.5** | **our own measurement** | king-present |residual| **1.946** vs no-king **0.201**, `corr = +0.954` — a **9.7× discontinuity between structurally adjacent plans** |

  > **R-14. Whether more search helps is governed, in three independent search
  > paradigms, by ONE quantity: the correlation between the values of sibling
  > options.** High: search helps and the evaluator's noise averages out. Low: the
  > selection operator picks the noise and more search makes it worse.

  Three consequences worth having: **one measurement serves all three domains** (so
  d40's M103, d45's C92/C94 and this domain's prediction collapse into one script);
  it is a property of **the game and the evaluator, not the algorithm** — changing
  search family does not change it, so it belongs in the **instance space** as a
  per-cell column beside deadness; and it **carries its own remedy direction**,
  because low correlation means evaluator work out-returns search work in that
  stratum (d40's M105).

**C95 — BELIEF/SEARCH: strategy fusion is the error the hypothesis market is
exposed to, and its two triggering conditions are already computable.** The market
opens hypotheses and refines *within* them; the plan chosen under A and the plan
chosen under B cannot both be played, so a best-per-hypothesis argmax is textbook
fusion. But the error needs **both**:
  1. **anti-correlated option values** across hypotheses (good under A, bad under
     B, and its mirror);
  2. **a guaranteed-better option elsewhere**.

  **Without (2) the search over-estimates the value but still chooses correctly.**
  Both are available from what the bank already produces: (1) is the sign pattern of
  an option's value across open hypotheses; (2) is *"is there a plan whose worst case
  across hypotheses beats every other plan's best case"* — **which is the sound
  floor's dominance test.** So: **flag a decision as fusion-exposed when an option's
  ranking flips sign across hypotheses AND no option dominates on the floor.** One
  predicate over existing output, marking exactly the decisions where a
  per-hypothesis argmax is unsafe.

  **Scope it to the advised channel.** The sound floor's `min` over hypotheses is
  already αμ's *"same move in all valid worlds"* discipline — the sound reading is
  not fusion-exposed; the advised one is.

**M116 — BELIEF `[+]`: our disambiguation factor is high, and this is one of the
survey's very few findings that predicts the architecture will WORK.** The paper's
two poles are **trick-taking card games** (each play reveals a card; `df` high;
determinization strong) and **poker** (nothing revealed until the end; `df` low;
weak). **We are structurally near the trick-taking pole**: units move and are seen,
territory is revealed by occupation, and a hidden unit's possibilities are pruned
every time it fails to appear where it could have. **The conditioning ladder's own
rungs are disambiguation events.**

  Two reasons to state this plainly: most of this survey's output is a warning, and
  this one says the determinize-and-search family the fog programme is heading toward
  is **the family that works in games shaped like ours** — and it says why, checkably.
  **Measure it: plot `|information set|` against turn number on the archive.** Fast
  decay confirms the favourable regime; slow decay says we are in poker's regime and
  determinization needs d12's heavier machinery (CFR-D, continual re-solving).

**M117 — MEASUREMENT: `bias` is d26's dead-cell criterion, derived from theory
instead of from a detector.** *"With very high or very low bias … there [are] large,
homogeneous sections of the game, and as long as a game-playing algorithm can find
these large regions, it should perform well."* Restated: **an extreme-bias cell
cannot discriminate between arms.** That is the dead cell, reached from game-tree
theory — and it gives the detector a **predictor** it lacked, since bias is
estimable from a handful of games rather than a full arm matrix. We have already
measured that ours varies: the **0.427 → 0.530 swing from spawn geometry alone** is
a bias measurement in exactly this sense. Testable prediction: **extreme-bias cells
are the ones where the arm matrix is flat.**

**M118 — VALUE/SEARCH: αμ is R-4's SEVENTH arrival, and the first that is
specifically an imperfect-information REMEDY.** It fixes strategy fusion *"by
playing the same moves in all the valid worlds during search"*, and non-locality by
using **Pareto fronts as the evaluations of states, combined at min and max
nodes**. R-4 has now been reached from maximality, α-vectors, contrastive
explanation, the Pareto front, the AC taxonomy's `set configuration` output,
absorption-dominant strategies (d38), and this. **This one differs in kind: it is
not a parallel construction, it is the published fix for the exact pathology our
search is exposed to.** A scalar per state cannot represent *"good under hypothesis
A, bad under hypothesis B"*; a front can, and combining fronts at min and max nodes
is what stops the search fusing strategies it cannot play. **So R-4 is no longer
only an argument about the Centaur surface and explanation — it is a soundness
requirement for search under fog.**

**Counter-argument worth keeping.** We are not doing PIMC in its pure form: the bank
keeps **sound bounds over a set of worlds**, which is closer to αμ's front than to a
sampled determinization, and the floor's `min` over hypotheses *is* the "same move
in all worlds" rule. That is a real defence and it locates the exposure precisely —
**the sound channel is not fusion-exposed; the advised channel is.** Also: `lc`, `b`
and `df` are defined over *terminal* payoffs and we cut off at a rung, so they need
re-expressing over *evaluated* nodes — which makes `lc` a property of the game **as
seen through our evaluator**, arguably the more useful quantity and exactly what
d31's residual work already probes.
