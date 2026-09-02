# PRIOR ART 2 — anytime algorithms and metareasoning vs the time lens's economy

Domain: the 35-year-old literature on *deliberation scheduling* — how much to
compute, when to stop, how to compose modules that can be interrupted, and what a
unit of computation is worth. Read against `time-SYNTHESIS.md` (determinations vs
quanta, spend/observe/ADVANCE, the allowance ledger, the exchange rate, the
hypothesis market, the reaction table) and `07-SYNTHESIS.md`'s ECONOMY joint.

This is the domain where our carve has the most *name-level* agreement with the
literature and the largest *object-level* gap: we have built an economy with
prices and no goods.

---

## 2.1 Load-bearing sources

**S4. Zilberstein & Russell, "Optimal composition of real-time systems",
*Artificial Intelligence* 82:181–213 (1996).** The composition theory: contract
vs interruptible anytime algorithms; the reduction theorem; conditional
performance profiles; global compilation NP-complete in the strong sense; local
compilation linear-time and *provably globally optimal for tree-structured
programs*; passive vs active monitoring.
(`rbr.cs.umass.edu/shlomo/papers/ZRaij96.pdf`)

**S5. Hansen & Zilberstein, "Monitoring and control of anytime algorithms: a
dynamic programming approach", *Artificial Intelligence* 126:139–157 (2001).**
Non-myopic stopping and *monitoring-interval* policy by DP, with the cost of
monitoring and the reliability of the quality estimator both first-class.
(`rbr.cs.umass.edu/papers/HZaij01a.pdf`)

**S6. Russell & Wefald, "Principles of metareasoning", *Artificial Intelligence*
49:361–395 (1991), and "On optimal game-tree search using rational
meta-reasoning" (IJCAI 1989; MGSS*/MGSS2).** The value of computation: a
computation's utility is derived *entirely* from its ability to change the
agent's external action; plus the two approximations that make it tractable (the
meta-greedy assumption and the single-step assumption).

Secondary: Horvitz & Breese, *Ideal partition of resources for metareasoning*
(the metareasoning-partition problem — resources spent on control are not
available for base-level work).

---

## 2.2 What the experts decided, and their stated rationale

### (a) Contract vs interruptible is a TYPE, and it does not compose

S4 draws the distinction sharply. An **interruptible** algorithm "produces
results of the advertised quality even when interrupted unexpectedly". A
**contract** algorithm "must be given a particular time allocation in advance"
and "if interrupted at any time shorter than its contract time, it may yield no
useful results". Depth-limited and alpha-beta search are named as naturally
*contract* algorithms.

The load-bearing negative result, stated in their own words as motivating the
reduction theorem: **"naïve composition destroys interruptibility"** — and
explicitly, *"this is the case even if the individual components are themselves
interruptible."* Their example: allocate a fixed budget optimally between a
diagnosis stage and a treatment stage; interrupting during diagnosis leaves you
with no treatment recommendation at all.

### (b) The reduction theorem, and the exact constant

**Theorem 2.7 (Reduction).** For any contract algorithm A there is an
interruptible algorithm B with q_B(t) ≥ q_A(t/4). Construction: run A repeatedly
with **exponentially increasing** time limits; on interrupt, return the best
result so far. The worst case is being interrupted just before the last
iteration completes, so the usable result came from the previous one; with a
multiplier m the ratio is (m²)/(m−1), whose minimum is **4 at m = 2**. So the
doubling schedule is optimal *within this strategy* and the penalty is a
constant factor of four. Applying this construction to a depth-bounded search
"generates an iterative deepening search automatically."

### (c) The performance profile is conditioned on INPUT QUALITY

S4's "crucial meta-level knowledge" is the **conditional performance profile**:
a table giving, for each time allocation, a *discrete probability distribution*
over output quality, **as a function of run-time and input quality**. Not a
mean; a distribution. Not unconditional; conditioned. The table size is an
explicit accuracy/space parameter and interpolation covers off-grid times.

### (d) Global allocation is intractable; local allocation is exactly optimal on trees

S4 §4: the decision version of globally allocating time across a functional
expression's components (GCFE) is **NP-complete in the strong sense** (reduction
from PARTIALLY ORDERED KNAPSACK). Their answer is **local compilation** —
"optimizing the quality of the output of each programming construct by
considering only the performance profiles of its immediate sub-components",
recursively. Complexity linear in program size. And the theorem that makes it a
design principle rather than a hack: local compilation is **globally optimal for
tree-structured expressions**. The tree condition is not decoration; the
NP-completeness construction is a DAG.

### (e) Monitoring is priced, and must beat not monitoring

S5 formalises stopping as an optimal-stopping problem solved by DP, producing a
policy over (time-step, observed quality-feature) that says *stop / continue /
continue-and-monitor*. Their stated guarantee, which is the reason to cite them:
the method **"only recommends monitoring if it results in a higher expected
value than allocating a fixed running time without monitoring."** So it can
*prove* that a fixed contract is right here. The payoff from monitoring scales
with the **variance of the performance profile**; on their Lin–Kernighan TSP
example, where variance is small, the gain is correspondingly small — and they
note it is significant that monitoring still helps "even when variance is small,
solution quality is difficult to estimate at run-time, and monitoring incurs a
cost."

They also name the passive/active axis: **passive monitoring** = all scheduling
decided before activation, components run as contracts; **active monitoring** =
reallocation after activation in response to *actual* rather than expected
performance.

### (f) Value of computation is decision-change, not uncertainty-reduction

S6's central move: the utility of a computation "is derived directly from the
ability of computations to affect an agent's external actions". A computation is
worth its cost only if it might change which action is chosen **and** the
candidate actions have different true utilities. Everything else — narrower
bounds, better estimates, more nodes — has *zero* value if the argmax is
unchanged. To make this computable they adopt the **meta-greedy assumption**
(consider only one computation step at each meta-level decision) and the
**single-step assumption** (evaluate a partial computation as though it were the
last one taken); both are acknowledged approximations, and the later literature
(Harada & Russell; Hansen & Zilberstein above) exists to relax them.

---

## 2.3 Mapping onto our joint

### AGREES

- **"The clock is read at exactly one point, to grant an allowance" is passive
  monitoring over a sequence of contracts** — the literature's own decomposition,
  arrived at independently. Our tranche = one contract; the allowance ledger =
  the (replayable) grant sequence. The vocabulary transfers wholesale and gives
  the design a 30-year pedigree it can cite.
- **The reaction table is a monitoring policy** in S5's exact sense
  (conform-now / next-tranche / next-commitment ≈ stop / continue / continue-and-
  monitor), keyed on the *source* of a determination rather than on observed
  quality. That keying is a legitimate variant, not a defect.
- **The anti-latch law** ("the worldline holds knowledge and appetite, never
  calibration") is the right instinct: a performance profile is calibration and
  belongs offline, compiled, not accumulated live.
- **The VALUE lens already conceded that `contingencies` is an ECONOMY quantity,
  not a preference term.** S6 is the citation for why: bound width is an input
  to *spending*, and converting it into distaste is exactly the category error
  R&W's framework forbids.

### CONTRADICTS — flag loudest

**C5. We have an economy with prices and no goods: there is no performance
profile anywhere in the design.** The time lens has an exchange rate
(deadline → allowance), a tranche-sizing policy, an allowance split across
phases, a hypothesis market and a reaction table. Every one of those is a
*policy over allocations*. Not one of them is a **model of what an allocation
buys**. In S4's terms we have written the compiler and omitted the library.
Without `Pr(quality | quanta, ·)` the split policy cannot be optimised, the
market cannot rank hypotheses, the exchange rate cannot be fitted, and "compared
at equal refine-quanta" is the only comparison available — which is why the one
question the time lens escalates to the owner is a *denominator* question. The
denominator question dissolves once there is a profile: you compare at equal
*expected quality*, not equal quanta.

  And the profile's conditioning axis is already built: S4 conditions on **input
  quality**; our premise coordinates ⟨support, observable, measure, config⟩ are
  exactly an input-quality index. `Pr(quality | quanta, premise)` fibers over
  premises for free. This is the cleanest cross-lens join in the whole survey:
  the joints lens's fibration is the type of the time lens's missing object.

**C6. Nothing in the manifest records whether a member is contract or
interruptible — and the composition law says it must.** S4: naïve composition
destroys interruptibility *even when every component is interruptible*. Our
decision pipeline (candidate generation → cluster enumeration → pricing →
closure → ordering → conformance) is a functional composition, and at least two
stages are natively contract algorithms (`cluster-enum` is exact-or-fallback;
alpha-beta-shaped pricing is the literature's canonical contract example).
Today the pipeline is rescued in practice by carrying a greedy incumbent — which
IS the interruptible construction, undesigned and unnamed. Two consequences:
  1. **`contract | interruptible` belongs in the joint manifest as a column**,
     per member, next to the composition law. A contract member inside an
     interruptible joint silently converts the whole joint to a contract; that
     conversion is the kind of silent premise-crossing the composition lens exists
     to refuse, and it currently has no type.
  2. The seed/incumbent is not a fallback, it is *the interruptibility witness*.
     Deleting or bypassing it (a tempting simplification once exact enumeration
     lands) breaks the pipeline's advertised type.

**C7. Local compilation is globally optimal only on TREES, and our manifest is a
DAG.** The joints lens's third move — "composition is a law per joint kind",
each joint composed from its members without a global solve — is precisely S4's
local compilation, and S4 supplies both the licence and its exact limit: optimal
for tree-structured expressions, NP-complete in the strong sense in general, with
the hardness construction being a DAG. Our manifest is a DAG by construction:
premise-fibered values are memoised and *shared* across joints (the evaluation
identity as memo namespace, `BankResult` reused across comparator rungs, one
`spend` serving several hypotheses). Sharing is exactly what makes it not a tree.
  Therefore: either the design declares an **allocation projection** of the
  manifest (the sub-graph over which allowance is split) and proves *that*
  projection is a tree, or it must state plainly that the split policy is
  heuristic with no optimality claim. Silently inheriting "law per joint kind"
  from a theorem whose hypothesis we violate is the same disease the composition
  lens names in §1.

**C8. The hypothesis market is missing its second factor, which is the only one
that matters.** The time lens proposes ranking conditional frontiers for the
next tranche. R&W: value = P(this computation changes the chosen action) ×
E[utility difference | it changes]. Our market as specified can weight by
P(hypothesis becomes fact) — reachable from the belief object — but nothing in
the design computes P(the refinement flips `better()`). That second factor is
where the entire literature's leverage lives, and it is computable here more
easily than in most domains, because `better()` is a *lexicographic comparator
over bounded quantities*: the probability that more work flips a rung is a
function of the current interval overlap at that rung, which `BankResult`'s
envelope already carries. This is a concrete, cheap, high-value build item that
neither the time nor value lens has named.

  Corollary that bites: **narrowing a bound whose rung is not currently
  contested has value zero.** Any economy that prices meets by width alone will
  systematically overspend on units that are not near a decision boundary. That
  is a candidate mechanism for the VALUE lens's "inert weight, cause (b)" — the
  term is not inert, the *spending* is misdirected.

### COVERS A CASE WE MISSED

**M4. Monitoring must be justified against a fixed contract, and we never ask.**
S5's guarantee is the shape of an acceptance test we do not have: for each
monitoring point, does monitoring beat a fixed grant? Our design keeps five
`shouldStop` consultation points (converted to counting cuts — good, that removes
nondeterminism) but prices them at zero. Two ledger columns make the question
answerable: monitor-check count, and the realised variance of quanta→quality per
tranche. And S5's finding gives a prior: **monitoring pays in proportion to
performance-profile variance**, so the first thing to measure is whether our
per-tranche quality improvement is high- or low-variance. If it is low-variance,
the correct design is *fewer* monitoring points and larger contracts — the
opposite of the instinct that more interruption points are always better.

**M5. Geometric tranches with ratio 2 are proved-optimal, and the penalty is
exactly 4.** If tranche sizing is a free policy dial, the design is silently
choosing a schedule whose interruptibility penalty is unbounded. S4 says: to
make a contract stage interruptible by repetition, double, and you pay ≤4×; any
other multiplier under that strategy is worse. Per ruling 49 this enters as a
**member with provenance — and its provenance is a theorem rather than a sweep**,
which is a provenance class the manifest should be able to express. (It is also
the first defensible default for `tranche sizing` in the absence of a profile.)

**M6. Passive/active is a named axis we should adopt verbatim.** Our design is
passive-with-per-tranche-re-decision, which the literature calls active
monitoring at coarse granularity. Naming it makes the ECONOMY joint's member
space legible: {fixed contract, passive multi-contract, active monitored}, each
with a known cost and a known applicability condition.

**M7. The metareasoning partition.** Horvitz & Breese: resources committed to
metareasoning are not available for base-level solving. Our ledger, market and
declaration records all consume decision time. The ECONOMY joint should carry
its own overhead as a first-class ledger row, and the anti-latch law should be
extended: the economy may not spend more on choosing how to spend than the
spread it can recover.

---

## 2.4 Verdicts the lens agents can act on

- **TIME (highest value item in this survey):** build the conditional
  performance profile before any further policy work. Type it as
  `Pr(quality | quanta, premise-coords)` so it fibers over the joints lens's
  premise index; compile it offline from the replay archive (the corpus already
  exists); and note that the owner's escalated denominator question dissolves the
  moment it exists. Add `contract | interruptible` to every ECONOMY/ACTION member
  and treat the incumbent as the interruptibility witness rather than a fallback.
  Default tranche schedule: geometric, ratio 2 (proved optimal, penalty ≤4).
- **TIME + BELIEF:** the hypothesis market needs P(refinement flips `better()`),
  computable from the current rung's interval overlap. Without it the market
  prices width, and R&W's whole point is that width without decision-relevance is
  worth nothing.
- **COMPOSITION:** "law per joint kind" is local compilation; its optimality
  theorem requires a tree, and our manifest shares sub-results, so declare the
  allocation projection and prove it a tree, or drop the optimality claim
  explicitly. Add the contract/interruptible column. Add a provenance class for
  fitted values whose provenance is a *theorem* (ruling 49 currently imagines
  sweeps).
- **VALUE:** S6 is the citation that settles `contingencies` → ECONOMY. Also
  note the corollary: refinement spending should be concentrated where interval
  overlap at the deciding rung is largest, which is a *different* allocation than
  "where the bound is widest".
- **ALL:** monitoring is not free and must beat a fixed contract; measure the
  variance of per-tranche improvement before adding interruption points.
