# PRIOR ART — the survey, its contradictions, and what to do about them

Branch `design/prior-art`. Commissioned under **ruling 50** ("this deserves
hours of academic research and inspection of expert open-source implementations
of the paradigms in use") and read against **ruling 49** ("fitted numbers enter
as members with provenance; the mandate is a joint-carving core machine").

Thirty-nine domains, surveyed against the four lens syntheses as they stood at
`origin/design/{time-interruption,belief-fog,value-evaluation,joints-composition}`.
Nothing here is a summary of a paper. Every entry is a mapping: *what the
experts decided, why, and whether our carve agrees, contradicts, or misses the
case.*

**Lens agents: start at `19-per-lens-rollup.md`** for what changes in your own
design, and read **`29-the-one-index.md`** for the one claim that spans all four
of you: *you are each conditioning on the same index and have each named it
something different.*

**Lens agents: start at `19-per-lens-rollup.md`**, which reorganises every
finding by whose design it changes. This index is organised by domain.

| # | domain | file |
|---|---|---|
| 1 | simultaneous-move search and the joint-action blowup | `01-simultaneous-move-search.md` |
| 2 | anytime algorithms and metareasoning vs the time economy | `02-anytime-and-metareasoning.md` |
| 3 | imprecise probability vs the (S, w) object | `03-imprecise-probability.md` |
| 4 | game-engine evaluation architecture | `04-engine-evaluation-architecture.md` |
| 5 | configuration, addressing and composition systems | `05-config-and-composition-systems.md` |
| 6 | rollback netcode and incremental computation | `06-rollback-and-incremental-computation.md` |
| 7 | community practice as a member mine | `07-community-practice-member-mine.md` |
| 8 | partial observability, POMDPs and one-sided POSGs vs the fog programme | `08-partial-observability-and-posgs.md` |
| 9 | evaluation, population distortion, and how to grow a roster (**ruling 49**) | `09-evaluation-and-population-distortion.md` |
| 10 | the Centaur surface: mixed-initiative control and explanation | `10-centaur-mixed-initiative-and-explanation.md` |
| 11 | game-rules architecture: one description, many consumers | `11-game-rules-architecture.md` |
| 12 | **decomposition under imperfect information** — the result that invalidates a hypothesis three lenses share | `12-decomposition-under-imperfect-information.md` |
| 13 | two engineering literatures our ladders should be members of (constraint propagation; progressive widening) | `13-inference-and-admission-schedules.md` |
| 14 | algorithm selection and portfolios — the theory of `Choice`, and a falsifier for the architecture | `14-algorithm-selection-and-portfolios.md` |
| 15 | opponent modelling and safe exploitation — **ε is a ledger, not a dial** | `15-opponent-modelling-and-safe-exploitation.md` |
| 16 | diminishing returns, and how to read a performance profile (response to the first compiled CPPs) | `16-diminishing-returns-and-reading-a-profile.md` |
| 17 | **coordination graphs** — the exact algorithm `cluster-enum.ts` is missing | `17-coordination-graphs-and-the-joint-argmax.md` |
| 18 | guarding a theorem's hypothesis — one law that unifies five recorded defects | `18-guarding-a-theorems-hypothesis.md` |
| 20 | response to the solutions-supplier refutation — my M38 over-claimed; the successor is one parameter away | `20-response-to-the-solutions-supplier-refutation.md` |
| 21 | response to the population instruments — the cyclicity question is *unasked*, not answered | `21-response-to-the-population-instruments.md` |
| 22 | **the theory of carving at joints** — Parnas's criterion, and modularity's option-value formula | `22-the-theory-of-carving-at-joints.md` |
| 23 | the dependency problem, and where our floor meets it twice | `23-the-dependency-problem-and-the-floor.md` |
| 24 | scalarization — the plans no weighting can reach (R-4's fourth and sharpest argument) | `24-scalarization-and-the-unreachable-plans.md` |
| 25 | response to the second round of measurements — **the game is NOT transitive**, and the VBS−SBS null may be a pooling artifact | `25-response-to-the-second-round-of-measurements.md` |
| 26 | instance space — which cells discriminate, and how to build more (the automatic dead-cell detector) | `26-instance-space-and-the-dead-cell-problem.md` |
| 27 | few-run statistics — what to report when you cannot afford many games | `27-few-run-statistics.md` |
| 28 | fitting a stochastic choice model to a deterministic agent — the V-alignment meter needs an order statistic | `28-fitting-a-stochastic-model-to-a-deterministic-agent.md` |
| **39** | **mixed initiative — prior art for the two OPERATOR lenses** (they are one decision with three outcomes and two thresholds) | `39-mixed-initiative-the-two-operator-lenses.md` |
| **38** | **provenance semirings — the bounds bank's annotation is in a named, lossy semiring**, and R-4 arrives a sixth time *inside* the value backup | `38-provenance-semirings-and-the-bounds-bank.md` |
| **37** | **time management in shipped engines — C8's second factor, twice implemented** (four free counters; and a CPP in milliseconds is a property of the machine) | `37-time-management-in-shipped-engines.md` |
| **36** | **algorithm CONFIGURATION — the field whose whole subject is the knob bag** (ruling 49's provenance has a required shape, and it contains the instance population) | `36-algorithm-configuration-and-the-knob-bag.md` |
| 35 | **shields** — the closure as a synthesized object, and the two guarantees ours does not have | `35-shields-and-the-closure.md` |
| 34 | index policies — the hypothesis market's missing algorithm | `34-index-policies-for-the-hypothesis-market.md` |
| **33** | **computing the set — R-4's missing engineering half** (the cost objection answered) | `33-computing-the-set.md` |
| 32 | accounting devices and policy levers — Ng's converse, and where policy actually lives | `32-accounting-devices-and-policy-levers.md` |
| 31 | extrapolation error — fitting on played games, pricing unplayed plans | `31-extrapolation-error-and-the-fold.md` |
| 30 | decision statistics and the minimum detectable effect (R-9) | `30-decision-statistics-and-the-minimum-detectable-effect.md` |
| **29** | **THE ONE INDEX — seven names for the same coordinate system** (the survey's only synthesis document) | `29-the-one-index.md` |
| — | **PER-LENS ROLLUP — everything above, reorganised by whose design it changes** | `19-per-lens-rollup.md` |

---

## If you only do seven things

Ordered by (value × cheapness). Every one of the first three runs on data
already on disk and needs no new games.

1. **Measure the two numbers nobody has measured** (domains 9 and 14, one script
   each, existing replays). *Nash averaging* over the arm-vs-arm matrix gives the
   **redundancy** of our evaluation population — Balduzzi et al.'s invariance
   axiom explicitly excludes Elo and uniform averaging, and their Atari
   re-evaluation *reversed* a headline conclusion. The **VBS−SBS gap** (per-seed
   oracle minus best single arm) gives the **complementarity** — the entire
   headroom of per-instance member selection, i.e. the falsifier for the joints
   architecture. Redundancy and complementarity are different quantities; we
   measure neither; together they are the only quantitative answer to ruling 49
   this survey found. Add the matrix's **cyclic fraction** while you are there:
   if our arms cycle, "which bot is better" is not a well-posed question.

2. **Record `(runner-up plan, deciding rung, margin)` for the top-k on every
   decision** (domain 10). `better()` computes it and throws it away. One
   telemetry column, three consumers: the contrastive explanation the Centaur
   surface requires (an explanation *is* a fact/foil pair), the input to
   `P(refinement flips better())` that the hypothesis market is missing, and the
   point-of-comparison spread the inert-weight taxonomy needs. Nothing else in
   this survey has a better ratio.

3. **Build the conditional performance profile** `Pr(quality | quanta, premise)`
   (domain 2). The time economy currently has prices and no goods: five policies
   over allocations, no model of what an allocation buys. It compiles offline
   from the replay archive, it fibers over the premise index for free, and the
   one question the time lens escalated to the owner dissolves once it exists.

4. **Add the fifth premise coordinate before fog step 5** (domain 12). Our
   decomposition arguments — `cluster-enum.ts`'s `φ_uv ≡ 0`, premise-keyed
   memoisation, re-base/ADVANCE — are perfect-information theorems, and
   imperfect-information decomposition is *provably unsound* with unbounded error.
   The fix is one coordinate (reach/range, or a counterfactual-value bound) and
   one new object crossing each boundary — a type the bounds bank already
   produces. Cheap now, unlocalisable later.

5. **Make the reduction return a set** (domains 3, 8, 10 — R-4). Maximality's
   optimal set, α-vectors' dominance regions and explanation's (fact, foil) are
   the same object seen from decision theory, value theory and cognitive science.
   A scalar reduction discards the Centaur surface, the value of information, and
   the record of what the search learned, all at once.

6. **Measure the induced width of our conflict graphs** (domain 17, one pass
   over the archive). `cluster-enum.ts` already builds a coordination graph and
   then discards its structure; **variable elimination** gets the same *exact*
   argmax at a cost exponential in induced width rather than in joint-space size,
   which would make the `512` cap essentially never bind and would emit R-4's
   conditional object for free. That one integer decides how much of this is
   available.

7. **Replace `sliderCandidateCap` with progressive widening** (domain 13).
   `⌊c·N^α⌋`: the cheapest of four principled replacements, needs no value model
   so it ships before (3), monotone so it composes with the incumbent, natively
   anytime. Requires the generator to expose an ordered list instead of
   discarding.

---

## The three things that recur across unrelated literatures

When four fields that have never heard of each other say the same thing about
our design, that is worth more than any single citation.

**R-1. Record what you read, not just where you read it (early cutoff).**
Domain 5 (build systems: only non-deep traces early-cut), domain 6 (Salsa:
backward flooding stops at an unchanged result), domain 4 (KataGo's graph search:
values shared without edge accounting stop being revised), and Nix RFC 062
(input-addressing rebuilds what cannot have changed) all land on the same
correction. Our declaration record names coordinates; it must also carry the
**hash of each value read and of the result**. Without that, citation-scoped
invalidation is narrow but never short, and `feature/commit-scope` recovers less
than it should.

**R-2. Sharing sub-results breaks compositional accounting unless edges are
first-class.** Zilberstein's local-compilation optimality theorem requires a
**tree** (global allocation over a DAG is NP-complete in the strong sense);
KataGo's `GraphSearch.md` shows transposed nodes silently freezing their parents'
estimates; Salsa and Adapton both track dependency *edges* rather than node
membership. Our manifest shares values by design (memo namespaces, one spend
serving several hypotheses). Either declare and prove the allocation projection
is a tree, or drop the optimality claim and make citations per-edge.

**R-3. Every restriction must be grown by BEST RESPONSE and carry the gap that
says how wrong it currently is.** This is the survey's single most important
structural observation, because the same algorithm appears at **three scales** of
our design and we have it at none of them: within a decision (double-oracle over
actions — DO-αβ solves in <2% of backward-induction time, and carries the value
gap); within a game (PSRO over policies — self-play is the degenerate case that
overfits); within the roster (best response to the roster's meta-Nash — the
procedural answer to "the config space is explored at low density"). At every
level our design instead uses a fixed cap, a fixed default, or taste:
`sliderCandidateCap: 4`, `DEFAULT_BOT_CONFIG`, hand-specced arms. Corollary form:
**every restriction of the option set must be adaptive on value or carry a
bound on what it removed.** Double-oracle restricts by best response *and carries
the value gap*; CMAB naive sampling restricts by a per-variable bandit updated on
realised reward; Prismata's HPS restricts by named portfolio scripts; Texel
learned by losing ~39 Elo that a principled-looking filter must be measured on
what it discards. `sliderCandidateCap: 4` is static, value-blind, weight-blind,
and unbounded — on the unit holding 80–91% of team weight.

---

**R-4. REDUCTION must return a SET of options with the conditions under which
each dominates — FOUR unrelated fields converge on the same type, and the fourth
makes it an impossibility result rather than a preference.** Multi-objective
optimization: **weighted-sum scalarization can only recover Pareto-optimal points
on the CONVEX HULL of the front; points in non-convex regions are unattainable
for every positive weight vector** (domain 24). The VALUE kind's declared law is a
weighted monoid — a weighted sum — so some good plans are unreachable at *any*
weight, and we have been sweeping weights looking for them. Chebyshev
scalarization reaches all of them and is nearly a drop-in. **And the cost
objection to R-4 does not survive** (domain 33): the expected non-dominated set is
`O((ln n)^{d−1})` — about **nine of a queen's seventy-one options at three
objectives** — the dominance conditions are the pruning LP's own witness, and
where anti-correlation blows the set up, Papadimitriou–Yannakakis guarantees a
**polynomially-sized ε-approximate Pareto set with a stated bound**. The set
formulation is also *better* under interruption than a scalar argmax: it shrinks
monotonically, so an interrupted reduction returns a sound superset rather than a
possibly-wrong pick. Imprecise
probability calls the set **maximal** and proves that Γ-maximin's set does not
shrink as beliefs sharpen (domain 3); one-sided POSG value theory shows the value
over belief space is **PWLC — a max over α-vectors with dominance regions**
(domain 8); the psychology of explanation shows a "why" question is always
**contrastive, a (fact, foil) pair** (domain 10). A scalar reduction discards the
Centaur surface, the value of information, and the record of what the search
learned, all at once. This is the survey's strongest single architectural
conclusion.

---

**R-5. Our architecture is a DECOMPOSITION architecture, and decomposition is
sound in perfect-information games and *provably unsound* in imperfect-information
ones.** Burch/Johanson/Bowling: "in imperfect information games, decomposition has
proven to be problematic. To date, all proposed techniques… have abandoned
theoretical guarantees" — and the failure is not inaccuracy but **increased
exploitability**, with unbounded error. Everything holds today (full
observability ⟹ the range is a point mass) and stops holding at fog step 5, in
four places at once: `cluster-enum.ts`'s `φ_uv ≡ 0` cross-component identity,
premise-keyed memoisation, re-base/ADVANCE, and depth threads. The constructive
fix (DeepStack's continual re-solving) needs exactly one new object crossing each
decomposition boundary: **a bound on the opponent's counterfactual value** —
which is a type our bounds bank already produces. See domain 12.

**R-7. The architecture's value is OPTION VALUE, and it is priced.** Baldwin &
Clark's net option value scales with `σ` — the *technical potential* of what might
be plugged into a module, "labeled σ because it operates like volatility in
financial option theory" — with the cost of an independent experiment and the
module's visibility as the other two drivers. A VBS−SBS null measured over a pool
containing a +0.996 duplicate pair is a measurement of **σ ≈ 0 for that pool**,
not of the architecture. So the honest pitch is not "hygiene": it is **the option
value of members that do not yet exist**, and the two levers we control are
lowering experiment cost (every composition increment does this) and lowering
visibility (R-2's DAG/tree question). See domain 22.

**R-8. Never test for a residual in a bounded statistic; transform to the scale
on which the null model is additive first.** Three investigations have now been
cost by this in one session: raw win probability saturates against a dominant arm
and manufactures a cycle where a transitive triple exists, which is why
Balduzzi's whole decomposition is defined on **logit** matrices. `sharePar` is a
bounded share, so the hazard is live beyond ratings. See domain 25.

**R-10. A statistic's invariances must be checked against the HYPOTHESIS, not
only against the data.** The rank meter is invariant to positive monotone
transforms — which is exactly why it was the right meter for `V`-alignment — and
the fold-vs-raw hypothesis differs by exactly such a transform, so the registered
test was void before it ran. The property that made the statistic right for one
question made it blind to another. Before registering: **list the statistic's
invariances and confirm the hypothesis is not inside them.** See domain 32.

**R-9. Before using a number to make a decision, ask what its limit is as the
data grows and as the effect goes to zero.** A statistic whose limit is
independent of the quantity you care about cannot inform the decision, however
carefully it is computed. Three faces of this were hit by three lenses in one
session: **R-8** a statistic bounded above saturates and *manufactures* structure
(raw win probability forced a transitive triple to show a cycle); **R-8b** a
statistic pinned at a boundary below cannot gradate, so it cannot rank (β̂ reads 0
for a nearly-right `V` and a completely wrong one alike); **R-8c** a statistic
whose denominator is the spend converges to "act" regardless of effect size (a
noise floor shrinking as 1/√n scored a thrice-dead cell 6.31 "live"). The next
instance will look different again; the question is cheap to ask of every new
column. See domain 30.

**R-8b (the other half of R-8). A boundary-saturating estimator cannot rank.**
R-8 warns about statistics bounded from above, which saturate and manufacture
structure. The dual is a statistic pinned at a boundary from below: β̂ reads 0 for
a nearly-right `V` and for a completely wrong one alike, so a "V-alignment meter"
built on it cannot do the one thing a meter is for. When the quantity of interest
is an **ordering**, use an **order statistic** — our comparator needs a `V` correct
only *up to monotone transform*, and pairwise order agreement tests exactly that
where log-loss does not. See domain 28.

**R-13. An annotation may be reduced before combining rather than after EXACTLY
WHEN the reduction is a semiring homomorphism.** Provenance semirings' Proposition
3.5: `q(h(R)) = h(q(R))` for every query `q` iff `h` is a semiring homomorphism.
So every consumer that turns an annotation into something smaller — a soundness
flag, a trust level, an `advisoryPrecision`, a UI badge, "does this survive the
re-base" — is a candidate `h` and must be checked, or applied only at the end.
This names the reason behind a defect already recorded (**C22**: interval
dominance sound at the leaf, unsound propagated up the deep channel) and settles a
live design question (whether a multiplicative precision may be applied per-term
and then combined through a `min`/`max` backup — in general, **no**). See domain 38.

**R-12. Every fitted or tuned number is the argmin of an expectation over a
POPULATION of instances. Name the population in the number's provenance, or the
number solves no stated problem.** The algorithm-configuration literature writes
the objective as `θ* ∈ argmin_θ ∫_I c(i,θ) dP(i)` and then says plainly that `P`
is unknown in practice, "and thus we must resort to solving a **proxy problem**"
over a training instance set. The population is not metadata attached to the
number; it is the measure the objective integrates against, and the gap between
the proxy and the objective is a generalisation claim someone has to make. This
is the common root of five things the survey recorded separately: the undeclared
seed population, extrapolation error's in-/out-of-distribution split (d31),
instance-space coverage (d26), Nash averaging's population redundancy (d9), and
ruling 49's own worry that the space is "explored at low density". For a
two-player game the population is a *joint* distribution over boards, seats,
seeds **and opponents** — so naming `P` here requires an equilibrium over the
roster, not a list of arms. See domain 36.

**R-6. Every soundness argument names a hypothesis, and that hypothesis must be
an executable assertion — or the argument will outlive its truth.** Five recorded
defects and two predicted ones are one disease: `φ_uv ≡ 0` (assumes point
positions), the static `CloudPremise` (assumes a sim covenant), premise-keyed
memoisation (assumes perfect information), the switch silently overridden per
engine, the miner reading an unpublished field, `MechanismReport.loop` before its
retrofit. The programme's own diagnosis — "a value and the premise it was computed
under travel separately" — is right and its remedy protects **values**; every one
of these was an **argument**, and arguments have premises too. The hypotheses are
already written down, as prose, in module headers and law suites. Prose does not
fail. See domain 18.

---

## Contradiction register

Ordered by how much they should change lens work. **C** = contradicts our carve;
**M** = covers a case we missed.

| id | lens | one line |
|---|---|---|
| **C49/C50** | SEARCH | **`maxJointsPerCluster: 512` bounds the wrong quantity, and the ICM fallback is the baseline the literature beats.** `cluster-enum.ts` builds an exact pairwise factor graph — which *is* a coordination graph — and then discards its structure to enumerate the product. **Variable elimination** computes the same exact argmax at a cost exponential in the **induced width**, not the joint-space size; at width 2 a 6-unit component costs ~162 ops where enumeration costs 729 and falls off the cap. Max-plus is the anytime replacement for ICM, with a monotone incumbent at every message round. Free first step: measure the induced-width distribution on the archive. |
| **C42** | COMPOSITION | **We have never measured our own VBS–SBS gap, and it is the falsifier for the whole joints architecture.** SAT practice reports both the single best solver and the per-instance oracle; the gap is the entire headroom of per-instance selection, and the field measures it BEFORE building a selector. Cheap on the existing archive. Large ⟹ the quantitative case for the manifest; small ⟹ the architecture must be pitched on hygiene, which is a different and more honest claim. Complementary to (not substitutable by) Nash averaging: redundancy and complementarity are different quantities and we measure neither. |
| **C43** | COMPOSITION | Our selection is at **config** time (and per *process*); Rice's is per **instance**. So even if the gap is large, the current architecture cannot capture any of it — which reframes the missing production bot-binding site from an operator convenience into the mechanism without which the portfolio thesis is unexpressible in production. |
| **C36** | SEARCH | **`cluster-enum.ts`'s "cross-cluster terms are PROVABLY ZERO" is a perfect-information theorem.** The proof is geometric and assumes each unit is at a *known cell*; a hidden unit is a *set* spanning components, so the same possible occupant appears in two clusters and `φ_uv ≡ 0` becomes false — silently, because no law-suite case has a subject whose position is a cloud. The exactness claim is load-bearing for everything above it. |
| **C37** | COMPOSITION | **Memoising by ⟨board, premise⟩ is the move the literature forbids**: under imperfect information a value depends on the *range* (how play arrived), so identical premises with different histories have different values. Fix is one coordinate: the premise index needs a fifth, **reach/range** (or a counterfactual-value bound). Sound today, unsound after fog step 5, and the cache returns a *plausible* wrong number. |
| **C38** | TIME | **Re-base IS continual re-solving**, and continual re-solving is sound *only* because bounded counterfactual values cross the boundary. Carrying nothing is the unsafe variant with unbounded error. ADVANCE's payload needs a bound — and DeepStack answers the worldline's open question: the minimal carried object is the opponent's counterfactual value bounds, far smaller than the carry store or hypothesis table. |
| **C73** | OPERATOR-INBOUND | **"Ask the operator" is a transfer-of-control STRATEGY, not a purchase** — a conditional sequence of *(who decides, for how long, what to do meanwhile)*, and **every viable strategy ends with the agent taking control back** (trigger: expected cost of continued waiting exceeds the decision-quality difference). The field's warning is aimed at our configuration exactly: rigid one-shot transfers in a domain of **teams** of agents plus a human *"failed dramatically"*, because the cost is **miscoordination**, not just delay — and our units act jointly. Closes C33 in a stronger form. |
| **C74** | OPERATOR-INBOUND / SEARCH | **The third action neither operator lens has conceived: change the plan to make waiting cheaper.** *"Reordering tasks to buy time to make the decision"* is a first-class action beside ask and act. For us: **prefer a plan whose commitment point is later**, so the answer arrives before it binds. Turns option value from a virtue into a **term in the interaction decision** (the consumer d22's pricing lacked), and it has a **window** — buy-time moves are *valueless after the deadline*, and the second is worth less than the first. Worth exactly one application, early. |
| **C75** | OPERATOR-OUTBOUND | **The outbound surface has "show"/"don't show" and is missing the middle band's existence.** Four utilities plus one belief give **two** thresholds — silence / **ask** / act unilaterally — and the middle band's width is how much a needless interruption costs relative to a needless mistake. **Sharpens C69**: thresholds *"can be directly assessed by designers or users"*, which *"implies a deeper implicitly assumed expected-utility model"*. So — **a number encoding a MEASUREMENT belongs in source with its provenance; a number encoding a PREFERENCE belongs in config, and its provenance is the four utilities it is a shadow of.** |
| **C76** | BOTH OPERATOR LENSES | **Every threshold moves with operator state, and we model no operator state at all.** Unwanted action costs *less* the deeper the operator's focus is elsewhere (raises the threshold); inaction costs *more* as they become rushed (lowers it). In this game both are the **standing condition**, not the exception — there is a clock, and there is a board. A **premise coordinate for the interaction decision** (d29); cheapest version is two proxies the harness already sees: which unit last received a manual command, and elapsed fraction of the deadline. |
| **C70** *(source-checked)* | COMPOSITION / SEARCH | **In both backups the LEDGER comes from the justifying child and the ASSUMPTIONS are unioned over EVERY child.** A child that contributed nothing to the number has its premises attached anyway — sound, but a refuted premise then invalidates a strict superset of what it should, with `justifier` already there as the fix. **Dormant with a scheduled activation date**: `unionAssumptions` fast-paths through `soleGroup` precisely *because* premises are uniform across branches today, and the fog programme's direction is branch-dependent premises. Framework half: set union on both operations is the named **why-provenance** semiring `(P(X), ∪, ∪)`, whose founding paper's worked counterexample is our use case (*"this cannot be detected by why-provenance"*). `N[X]` is **universal**, so annotating with structure keeps every coarser reading computable later; collapsing to a set is a one-way door. |
| **C72** | BELIEF / SEARCH | **Our premises are substantially NEGATIVE, and the standard provenance machinery is known to be inadequate for exactly that** — *"it did not really offer an adequate treatment of negation or missing information"*. The fog premises (*the queen is not at c4*) and the conditioning ladder's item-vanish disjunction and joint exclusion are **negative provenance tokens**. Named fix: **dual-indeterminate polynomials**, whose congruence `x · x̄ = 0` says structurally that a bound resting on a fact and its negation is dead, instead of deferring it to a consistency pass. Same disease as **C26** one layer up: the representation is positive-only and the content is not. |
| **C66** | TIME | **C8's second factor has two shipped implementations and we keep none of their inputs.** Stockfish estimates `P(refinement flips the choice)` from four counters that are byproducts of work already done: **iterations since the incumbent last changed**, **times it changed this iteration**, **the incumbent's value trend over a 4-slot ring buffer**, and **the share of nodes spent under the incumbent**. No model, no intervals, no CPP needed — and three of the four are C48's missing discriminator: *a search that has stopped changing its mind is exhausted; one that keeps flipping at the same score is coarse.* Count them **per hypothesis**, or simultaneity confounds the signal. |
| **C67** | TIME | **A soft target and a hard ceiling, with a 3.14×–6.87× gap** — not one allowance. Stockfish plans `optimumTime` and permits `maximumTime`; the eval-trend factor alone spans 3× (0.576–1.728). An allowance that *is* the ceiling cannot spend three times the plan on the turn that deserves it. The gap is set by **game state** (ply, remaining clock), not by the search's own uncertainty. |
| **C68** | TIME / MEASUREMENT | **A CPP keyed on milliseconds is a property of the machine.** "snake6 saturates at 500 ms" is unfalsifiable across hardware — fatal for a number that prices tranches. The shipped fix is `nodestime`: denominate the budget in a **deterministic work unit** and calibrate to the clock as one measured machine-local constant. The profile then becomes versionable, diffable and attributable, which is what keying it on `evalVersion` was already reaching for. |
| **C69** | COMPOSITION | **A fitted constant is not a knob.** Fifteen SPRT-tuned constants live in Stockfish's *source*; the user options are the structural choices only (`Ponder`, `Move Overhead`, `nodestime`, `Threads`, `Hash`). *Its value is a claim that won a test; a knob is a claim nobody has made* — exposing one invites a setting that never passed the test that justified the number, silently voiding its provenance. Corollary: `keepQuiet: 2` and the four caps are each either **fitted** (belong in source with provenance) or **unfitted** (an admission, not a configuration). The knob bag pretends there is a third category. |
| **C62** | OWNER / VALUE / MEASUREMENT | **A tuned number's provenance must name the instance POPULATION, because the objective is an expectation over it** (R-12). Ruling 49 reads provenance as *who set it, from what evidence*; the field's provenance tuple is `(Θ, c, m, I_train, P, budget)`, and dropping `P` makes the objective undefined rather than imprecisely estimated. This is the value lens's §4 finding relocated: not a reporting-hygiene item, the missing half of equation (1). Our seeds are pinned contiguous ranges drawn from no declared population — and spawn geometry alone already swings the answer **0.427→0.530**. |
| **C63** | MEASUREMENT / TIME | **We run every comparison to completion; the field RACES and CAPS — and pays a named price.** F-Race discards on a test; ParamILS accepts only on *more instances AND lower cost*; LeapsAndBounds budgets by **empirical Bernstein** stopping. That is a *procedure* where domain 27 offered only statistics. But capping right-censors, and the loudest statement of the consequence is that **Structured Procrastination deliberately returns the configuration with the longest total execution time rather than the best empirical mean.** Live hazard: **the CPP** — if deep rungs are only reached on easy premises, the profile is optimistic at depth, which is a second and purely statistical explanation for C48's ambiguous saturation. Copy SP's rule: postpone hard instances with a **doubled** timeout; never discard them. |
| **C64** | VALUE | **"Which knobs matter" is REGION-dependent, and we live in the region where main effects are smallest.** fANOVA on the same scenario: main effects are **88%** of raw-performance variance but **26%** of improvement-over-default variance; pairwise interactions reach **45%**. Our slots are already hand-tuned, so a full-range sweep will over-state main effects and hide exactly the interactions that bind. Decompose over improvement-over-default. (Cost: seconds, on already-logged runs.) |
| **C65** | TIME / COMPOSITION | **The economy is DYNAMIC algorithm configuration, whose output is a policy — and DAC's stated prerequisite is a runtime STATE DESCRIPTION the target algorithm must emit.** The scoped margin-column field is one element of that vector; the general requirement is that without `Q` there is no policy to learn, only a configuration to pick. DAC's own `Q` examples (iteration, restart count, current solution quality) are our quanta spent, re-base count and incumbent margin — d29's one index from a sixth direction. |
| **C28** | OWNER / VALUE | **Every headline number is a non-invariant aggregate over a redundant population.** Balduzzi et al.'s P1 axiom — "adding redundant copies should make no difference" — *excludes Elo and uniform averaging by name*, and the bias "can only be detected post hoc". Their Atari re-evaluation flipped "superhuman" to "ties with humans". Fixable on the archive we already hold: build the arm-vs-arm matrix, take the **maxent Nash**. |
| **C29** | OWNER / COMPOSITION | **Nobody has checked whether our arms cycle.** A simultaneous-move game with contested cells manufactures rock-paper-scissors structure; if the cyclic fraction is non-negligible then "which bot is better" is not well posed, a roster must be a **mixture** not a champion, and the missing production bot-binding site becomes a blocker. Two-hour check on existing data (mElo's Schur decomposition). |
| **C30** | COMPOSITION | **The roster grows by taste; PSRO grows it by best response to the current meta-strategy** — which directs exploration exactly where the population is weakest. The procedural answer to ruling 49's "explored at low density", instead of "run more arms". |
| **C1** | BELIEF | ε=1 is the *pure security level*, not "the adversarial zero point". In a simultaneous-move game the field's zero point is the stage matrix's **NE**, solved by LP — a distribution, not a scalar worst case. No ε reaches the correct answer. Needs a third reading beside sound/advised: **equilibrium**. |
| **C48** | TIME | **A saturating CPP has two opposite diagnoses and the profile alone cannot tell them apart**: "search exhausted" vs "evaluator too coarse for depth to bite on". The chess literature says the second historically dominates and *masquerades* as the first (it hid diminishing returns for fifteen years), and our own evaluator measurements point that way on the board that saturates. Discriminator: a second CPP axis, **the margin at the deciding rung** — which is the same column the contrastive surface, the VOI input and the inert-weight instrument all want. Also: key the CPP on `evalVersion`; the saturation point is a property of the evaluator. |
| **C5** | TIME | An economy with prices and no goods: **no performance profile exists anywhere**. Zilberstein's conditional performance profile `Pr(quality \| time, input quality)` is the missing object; our premise coordinates are already an input-quality index, and the owner's escalated denominator question dissolves once it exists. |
| **C12** | BELIEF / VALUE | Γ-maximin's optimal set **does not shrink as beliefs sharpen** (Troffaes) — it returns one option even under complete ignorance. That is the one property a Centaur option-surfacer must have. **Maximality** returns it natively. Strongest architectural argument for the Centaur direction in the survey. |
| **C25** | BELIEF | **Nothing in the architecture makes information valuable.** No action is ever valued for what it reveals — VOI sits half in ECONOMY and half nowhere — which is QMDP's named failure mode. Prediction: under invisibility potions the bot will never spend a move to scout. C12 is the dual (the reduction cannot express "I now know more"); two mechanisms, one symptom, in the programme whose flagship feature is fog. |
| **C26** | BELIEF | **Marginal clouds cannot store what the conditioning ladder computes.** C1 (item-vanish) is a *disjunction across units* and C2 a *joint exclusion*; per-unit marginals hold neither, so both rungs evaporate at the moment of storage and will measure as worthless when they are merely unstorable. The trace needs a constraint store; marginals are the query surface, not the state. |
| **C31/C32** | VALUE / COMPOSITION | Our apparatus emits **numbers with provenance**, which Miller's survey identifies as the *least effective* form of explanation ("statistical generalisations are unsatisfying unless accompanied by an underlying causal explanation"). The fold's **per-unit flows are the causal vocabulary** — so the surface must be built on flows, never the aggregate, and flows must not be summed before caching. And nothing produces a **foil**: `better()` computes the deciding rung and margin on every decision and throws them away. |
| **C33** | BELIEF / TIME | **"Ask the operator" is a purchasable observation with no row in the economy.** There are three ways to remove width — deduce, observe, ask. We have the first, are missing the second (C25), and have not conceived the third. Under game-held width it is the *only* available lever. |
| **C45/C46** | BELIEF / VALUE | **ε as "the operator paranoia dial" is the wrong carve.** Ganzfried & Sandholm achieve safe exploitation "by risking in exploitability at most what has been earned over the Nash equilibrium in previous rounds" — the deviation from the floor is an **accounted budget**, not a chosen parameter. In our currency that budget is `realised share − floor share`: one more account in the existing ledger, no new unit, and it upgrades the sound floor from a veto to a *reference point*. Also: deviation is **triggered by a detectable gift**, and we have no gift detector — though the replay-rebase mechanism already reconstructs exactly what one needs. |
| **C9/C10** | BELIEF / JOINTS | Our ε class is Walley's linear-vacuous mixture, and **that class dilates**: conditioning can widen the credal set *for every possible observation*. So `meet = narrow` holds for S (deduction only) and **fails for w**. You can pay for an observation that provably makes you less certain. |
| **C7** | COMPOSITION | "Law per joint kind" **is** Zilberstein's local compilation — a theorem whose optimality hypothesis is a **tree**. Our manifest is a DAG. Declare the allocation projection or drop the claim. |
| **C8** | TIME / BELIEF | The hypothesis market lacks its second factor. Russell & Wefald: a computation's value comes entirely from its ability to **change the chosen action**. `P(refinement flips better())` is computable from interval overlap at the deciding rung, which `BankResult` already carries. Corollary: narrowing an uncontested rung is worth exactly zero. |
| **C34** | COMPOSITION / BELIEF | **B4 should expose the spawn DISTRIBUTION, not inject a sampler.** OpenSpiel makes chance an explicit player whose outcome distribution the state exposes, so search can plan *through* a stochastic event. B4's own acceptance game (walk to a potion three turns early, the window opens in the model) is the case that separates planning from gambling on a draw. Side effect: it derives the time-indexed CloudPremise from the interface instead of restating it as a premise that can go stale. |
| **C35** | COMPOSITION | Exporting `adjudicate` fixes one rule; the defect class is **having no single rules artifact**. Ludii/OpenSpiel: one place a rule can be written, every consumer a derived reader. Our three recorded instances (adjudication ×3, the UI deriving no legality, the bot re-deriving movement three wrong ways) are one class. Needs a rules module whose export surface IS the consumer interface, plus CI forbidding re-implementation. |
| **C61** | COMPOSITION / SEARCH | **Our closures are hand-written predicates and neither shielding guarantee holds.** The formal-methods literature's filter-between-agent-and-world is *synthesized from a specification*, giving **correctness by construction** and **minimal interference**. `certainlySelfFatal`, `keepQuiet: 2` and the tier bands implement a safety intent that exists **only in prose** — nothing to check them against, in the highest-stakes place to have a hand-written re-derivation of the rules (C35's defect class, applied to a filter that silently deletes options). And nothing establishes they remove *only* what the intent requires. `[+]` ours are **pre-decision** shields, which is the architecture the literature prefers. Fixes are cheap: state each closure's spec in the rules module and differential-test it (M85); count interference on the archive (M84). |
| **C16** | COMPOSITION | `botId` is a **deep constructive trace** — the one rebuild strategy that provably cannot early-cut. Behaviour-preserving config edits cold every memo; two identical bots get different addresses. Fix: Nix's **resolved derivation** (address the resolved closure). |
| **C21** | COMPOSITION / TIME | **Identity-for-reuse and equality-for-dedup are two keys with opposite laws**, and `botId`/premise ids are doing both. A name must be stable across the change you want to be incremental in; a content hash must not be. Every cross-turn mechanism (attention carry, warm promotion, ADVANCE) is a reuse problem, not a dedup problem. |
| **C19** | TIME | `observe()` **kills eagerly**; Adapton/Salsa **dirty then verify on demand**. Eager invalidation spends the scarcest compute at the worst moment (operator commit, deadline approaching) on work this turn may never demand. |
| **C13** *(corrected against source)* | VALUE / TIME | The un-incrementalisable object is **`partitionOf`**, not the fold. `(K, W, p)` is a per-turn constant, so the derived fold is *more* updatable than the shipped evaluator. But `partitionOf` is a whole-board set-cover over every admitted unit, recomputed per reading, so one unit's plan changes every unit's cell count. `feature/commit-scope`'s 343 ms therefore rests on **cluster/reading-granularity** invalidation, not per-term incrementality — coarser and more fragile than the design's language suggests. NNUE's analogue fix (observer-local basis + declared refresh trigger) is an uncosted design option. |
| **C2/C3/C4** | COMPOSITION / TIME | `sliderCandidateCap` is the one thing no serious implementation does (see R-3). Enumerate-then-cap is also the wrong *order* — the field grows the arm set lazily, which is what makes it natively anytime. Our above-budget fallback (ICM) is Portfolio Greedy Search, the algorithm the RTS follow-ups exist to beat. |
| **C6** | COMPOSITION / TIME | **"Naive composition destroys interruptibility, even when every component is interruptible."** `contract \| interruptible` must be a manifest column. Our greedy incumbent is the undesigned interruptibility witness — three literatures now say so (Zilberstein, `cluster-enum.ts`, a1k0n's ply boundary). |
| **C23** | TIME | A per-turn checksum detects divergence but cannot **localise** it, and GGPO's named desync causes are our hazards verbatim ("iteration over an unordered collection"). Promote `subStepCount` + per-sub-step checksums out of "additive polish". |
| **C24** | OWNER / VALUE | The winner of the closest public tournament (Tron) states that **a better evaluation always beats a deeper search** in this family, and names the mechanism: deep search over a wrong leaf is self-deluding. Our evaluator is measured as weight-blind and definitionally wrong on three teams; depth is the flagship. Testable free on the existing corpus. |
| **C14** | COMPOSITION | KataGo's graph-search corruption: a shared value updated through one path leaves the other parents' estimates frozen, and the exploration rule then prefers the wrong child indefinitely. Second independent statement of R-2. |
| **C15** | MEASUREMENT | Texel paid ~39 Elo for a principled-looking filter he never measured on what it removed. We have four such filters and have measured none of them that way. |
| **C17** | TIME | Declared access buys **safety, not order** (ECS). Fine-grained keys are unstable under refactoring — coarsen deliberately; deliberate ambiguity needs a first-class annotation or the checker becomes noise people disable. |
| **C11** | BELIEF | Terminology collision: we use "dilation" for dynamics-driven spread; the field reserves it for the conditioning pathology. Anyone reading both will believe we have addressed it. Rename ours to **spread**. |
| **C27** | BELIEF / TIME | The observation-side restriction has no bound. DESPOT restricts to **K sampled scenarios with all action branches retained** and carries a **regret bound**. R-3 in the one dimension where we have not committed; committing now is far cheaper than retrofitting a cap. |
| **C18/C20/C22** | COMPOSITION / TIME | Reachability should be stated over the *resolved* closure; the re-base window needs a hard cap with defined over-cap behaviour (GGPO stalls by design); interval dominance is sound at the leaf and unsound propagated up the deep channel. |

### Cases we missed, ranked by cheapness

| id | one line |
|---|---|
| **M24** | "Is this member worth keeping?" gets a formal, ungameable answer: **it has support in the meta-game's Nash equilibrium**. Stronger than the reachability law's intent and immune to the counter it already worries about (a roster bot that exists only to keep a member alive). |
| **M26** | mElo's **latent-skill decomposition** of the cell × arm matrix answers "what does this cell actually test?" — the dead knight cell would appear as a near-zero singular value automatically, without anyone reading `moveGrammar.ts:27`. Subsumes the value lens's M5. |
| **M36** | **The constructive answer to C26:** the conditioning ladder IS a constraint satisfaction problem and Minesweeper is its solved special case — C0 is a cardinality constraint, C1 a disjunction, C2 a negative joint. Keep a **constraint store partitioned into coupled subsets**; derive marginals by query; and get the canonical weight from **solution counting**, which makes the design's own cover-counting claim literally true. |
| **M39** | **The cheapest principled replacement for `sliderCandidateCap`: progressive widening**, `⌊c·N^α⌋`. Natively anytime, monotone, needs no value model (so it ships before the performance profile), and turns "4 forever" into "4 at the first tranche, more as tranches are spent" on the unit holding 80–91% of team weight. |
| **M99** | **Operator guidance is a MEMBER, not a SHIELD — and the distinction is the whole inbound design.** d35 established our closures are pre-decision shields, not tradeable at any weight. Advice is the opposite case: advice-taking systems compile it where *"subsequent learning further integrates and refines"* it, so wrong advice degrades rather than cripples. Guidance may **price** plans, seed an order, or open a hypothesis — it must **never remove** plans from the admitted set, because a wrong removal is unrecoverable and (per C70) invisible downstream. |
| **M100/M101** | **"Do less, but do it correctly under uncertainty"** is R-4's Centaur half as an interface rule: the granularity of what you commit to and show should **shrink as uncertainty grows** (a direction not a cell, a role not a path, the set not a pick) — d33's ε is the dial and this is the rule for setting it. And **the overrides are labelled data the archive already holds**: every override is a human-labelled example of a decision the bot got wrong, which fits the ask/act threshold instead of guessing it, marks the instance-space cells where the evaluator is worst, and is the **only** signal anywhere about what the operator actually wanted. |
| **M96/M97** | **R-4 arrives a SIXTH time — inside our own computation — and brings the foil with it.** Evaluating a game's fixed point in a polynomial semiring gives *"not only who wins, but how they win and which strategies they might use"*: all **absorption-dominant strategies, those that win with minimal effort**. Absorption is R-4's dominance filter **built into the algebra**, so the non-dominated set is a by-product of the backup rather than a second pass (complementary to d33's LP: absorption prunes *derivations*, the LP prunes *objectives*). And the same machinery's stated application — *"minimal modifications to the game needed to change its outcome"* — is **C32's missing foil**, computed from the annotation instead of by re-running a counterfactual. |
| **M98** | **The answer to provenance blow-up is a CIRCUIT, and our bound DAG already is one.** Keep the annotation as a DAG of `+`/`×` gates with sharing, evaluate under a valuation in linear time, never expand. So the fix is not "store a polynomial per bound" — it is *stop collapsing the structure you are already building into a set at every node*. The set is one valuation of the circuit. |
| **M95** | **The bounds bank already computes Lc0's exact stopping rule** — *can the remaining refinement flip `better()`?* is an interval-overlap query. Copy its **two guards**, which are what make a sound rule usable: a deliberate **over-prune factor** (Lc0's default is 1.33 — stop *before* the provable condition, a member with its failure direction stated) and a **minimum-work floor**, because at tranche zero the bounds are vacuous and the sufficiency test fires in the wrong direction ("instamoves on slow backends"). Exact rule where bounds exist; the four free counters everywhere else. |
| **M92/M93/M94** | **Three shipped economy rules.** Pondering is funded by making the **current** move 25% more expensive, not by reserving (`optimumTime += optimumTime/4`), and a stop while pondering is not a stop — free compute is spent to exhaustion. **No new rung is begun past 50% of the budget**: a rung is a *contract* algorithm, so its marginal value is its value × `P(finish)` (rule suspended while pondering). And **bad news is worth more computation than good news at a measured 3×** — an asymmetry the sound floor already encodes at the value layer and the allocation layer does not, so the economy is under-funding exactly the positions the evaluator is most worried about. |
| **M87** | **Ruling 49's provenance artifact already exists and it is a PATH: ablation analysis.** An ordered list of single-parameter changes from the previous default to the new setting, each with its measured contribution — **>95% of the gain** between default and configured is accounted for this way in the published scenarios. It is the member-with-provenance shape in runnable form, it **falsifies bundles** (five of six coefficients contributing nothing means five members should not be admitted), and it is `O(k²)` comparisons — ≤78 for twelve slots — on the arm-vs-arm harness that exists. |
| **M88** | **Coordinate-wise tuning is empirically near-optimal, and the licence is checkable.** Parameter responses and full configuration landscapes are *statistically indistinguishable from uni-modal at 95%*, and optimising each parameter once in random order is often *statistically tied with optimal*. Corroborates the ICM fallback and the one-slot-at-a-time habit — but it is a regularity, not a theorem, so R-6 applies: sweep one slot at fixed others and **test uni-modality**. |
| **M89** | **`ratio = 2` now has three convergent optimality results** — Zilberstein's contract→interruptible reduction, our own tranche design, and Structured Procrastination's doubling timeout queue (runtime-optimal up to a log factor for the configuration problem). The strongest provenance class the survey has found for any of our numbers, and exactly the form ruling 49 wants. |
| **M90** | **Empirical Bernstein stopping** is the few-run *procedure* domain 27 could not name: allocate budget by a bound using the observed range and variance rather than a pre-committed `n`. The variance-adaptive form of R-9's MDE work, and it composes with the stratified bootstrap already built. |
| **M91** | **`set configuration` is a first-class output type in the AC taxonomy — R-4's fifth independent arrival, one layer up.** And the field's own open problem is ours: the **Pareto front of the target algorithm** and the **Pareto front over configurations** are different objects that get conflated. Those are our plan set (d33) and our member collection (ruling 49). |
| **M84** | **Interference is one counter per closure over the existing archive**: how often, and by how much, does each closure remove the plan the unfiltered search would have chosen? It measures the property the shielding literature requires, and it separates a closure that never binds (delete it, per the reachability law) from one that binds constantly (a *policy* sitting in the wrong layer). Same shape as the deadness column and the admitted-set instrument, so the harness exists. |
| **M11** | **Paired seat-swapped scenarios + pentanomial scoring** (Fishtest). The pentanomial-vs-trinomial gap is *itself an estimate of the population's bias* — the closest thing found to an instrument for ruling 49's distortion worry. |
| **M13** | **Per-unit flows as standing telemetry.** KataGo's ownership head exists for credit assignment from few samples. Promoting our mining scripts to a per-game column turns 144 games into thousands of unit-observations at zero play cost — the cheapest answer to "the space is explored at low density". |
| **V-3** | **The checkerboard parity bound** (a1k0n) — sound, free, strictly tighter than a cell count, and we lack it. |
| **V-2** | **`room` should count edges, not cells.** a1k0n's mined fit: edges carry ~3.5× the weight of nodes. Reproducible on our archive this week with the value lens's existing tooling. |
| **M30/M32** | `information_state` vs `observation` as *separate interface methods* (OpenSpiel) makes "asked for the wrong one" a type error rather than a silent cheat — the mechanism that makes fog step 5's byte-identity acceptance checkable. And Ludii's benchmark answers the "declarative is slow" objection: compile the description once, run the fast form. |
| **M14/M19** | **Verifying traces** and **Salsa durability** — the built, named answers to early cutoff and to composition risk 1 respectively. |
| **M1** | **The serialized-equilibrium pre-check**: if the two serialized games agree, the stage game has a pure equilibrium and the LP/joint machinery can be skipped. A free per-cluster reclassifier. |
| **M18** | The hypothesis market's free baseline is "the enemy repeats" (GGPO's predictor carries an entire genre). |
| **M5** | Geometric tranches, ratio 2, penalty ≤4 — **proved optimal**, a fitted value whose provenance is a theorem rather than a sweep (a provenance class ruling 49 does not yet name). |
| **M20** | From-scratch consistency, sampled in production — generalises the replay-rebase differential test from the engine to the incremental value layer. |
| **R-1 (V-4)** | The **articulation-point chamber tree**: 12–1 in the ancestor game, and largely re-use of our existing component decomposition. |
| **M21** | **PWLC**: the value over belief space is a max over α-vectors — natively a **set of plans with dominance regions**, which is maximality's object (domain 3) reached from a third direction, and it is exactly the Centaur output. Also: α-vectors stay valid over belief *regions*, a far stronger cross-turn carry than a scalar bridge. |
| **M17** | The weight-supplier socket wants **effect-handler semantics** — handler installed by the decision context, unhandled = type error. The structural fix for "ε = 1.0 chosen by nobody". |
| **R-1 (REDUCTION)** | REDUCTION gets its second and third members — {paranoid, MaxN, share-weighted asymmetric fold} — satisfying "no joint with one member" and turning the three-team balance bug into a member selection. |

---

## What the survey corroborates

Not everything is a contradiction. Four of our moves are independently confirmed
by people who ship:

1. **The replay-rebase design is the GGPO contract, correctly derived** — send
   inputs, re-simulate locally, checksum to detect divergence, fall back on
   mismatch, and get a free live differential test. Rollback developers treat
   that last property as a main benefit of the architecture.
2. **Per-unit weight accounts are KataGo's ownership head**, arrived at
   independently, down to the board-area normalisation (`w_o = 1.5/b²` ≈ our
   `K/W`). KataGo supplies the argument our VALUE lens has not made: the payoff
   is *credit assignment from few samples*.
3. **`cluster-enum.ts`'s order-2 Möbius surrogate is strictly stronger than the
   naïve assumption** `μ(X) ≈ Σᵢ μᵢ(Xᵢ)` that the whole CMAB family rests on. We
   do exact inference on small clusters where the literature samples
   approximately. The design docs should say so.
4. **Prismata's Hierarchical Portfolio Search is the closest shipped precedent
   for the joints carve** — a commercial simultaneous-move, combinatorial-action
   game AI whose stated rationale for the portfolio architecture is *robustness
   to balance changes*. That is ruling 49's mandate, validated by a product.

---

*Nothing in this directory is final. Sources are named so every claim can be
checked, and every fitted number quoted carries its provenance.*
