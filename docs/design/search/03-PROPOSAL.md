# 03 — The PROPOSAL joint: where a trial comes from

SEARCH-THEORY lens, document 3. Owns design question (4): *multi-start random
seeding + softmax selection just replaced a constructed seed — what does the
literature say about basin coverage in combinatorial local search that we should
encode as the seeding joint's law?*

The scope is wider than seeding, because seeding is one member of one sub-joint.
The joint is: **every operator that puts a new joint plan in front of
`better()`**, of which there are seven in the shipping code and they have never
been listed together.

---

## 1. The seven proposal operators we already have

| # | operator | shape | where |
|---|---|---|---|
| 1 | **rung-0 conform** | per-unit ordered-first, pins spliced, legality repaired | `conform`, `kernel.drive` rung 0 |
| 2 | **multi-start stage 0** | uniform draw over provably-safe moves; where no unit-safe move exists, over safe *joint* combos; `stage0Attempts: 8` randomised orders | `multistart-seed.ts::stageZero` |
| 3 | **multi-start stage 1** | up to 4096 random joint samples per cluster, each hill-climbed `climbSteps: 2`, then softmax-selected from a pool of ≤512 | `multiStartSeed` |
| 4 | **cluster enumeration** | exact order-2 solve per component, k-best with Hamming floor, composed best-first | `cluster-enum.ts`, offered by `offerClusterJoints` |
| 5 | **sweep** | 1-opt: one unit onto one of its top-`candidateCap: 8` options | `core.ts::sweep` |
| 6 | **pair repair** | 2-opt over resolver-named self-inflicted casualty pairs, `pairRepairPerUnit: 4` each | `core.ts::pairRepair` |
| 7 | **joint polish** | exhaustive over ≤3 contested/crowded units × top-2 options | `core.ts::jointPolish` |
| 7½ | **perturb restart** | one unit, deterministically chosen, onto a deterministically chosen different option; `restarts: 2` | `core.ts::perturb` |

Two facts about that table matter more than any individual row.

**Two of the seven are off by default.** `multistarting()` is
`cfg.multistartSeed ?? false` and `sampling()` is `cfg.sampledCap ?? false`.
The owner's seeding ruling was *"recorded as binding and now building,
flag-gated and dark"* — it is built, and it is dark. That is a fact about the
roster, not about the design, but it means every number quoted about "our
seeding" today describes operator 1 followed by 4–7, not the redesign.

**They have no common type.** Each is a bespoke function with its own budget
accounting, its own randomness (three separate `NODE_*` streams plus the
multi-start's own tagged seed), its own diversity notion (`minHamming` in one,
`crowdingRadius` in another, nothing in the rest), and its own place in the
control flow. There is no list, so there is no way to ask "which operator paid
for itself on this board", and no way to add an eighth without editing `improve`.

## 2. The literature's actual law, and it is not the one we implemented

The redesign's argument was: *one seed is one basin; a search handed one start
can only climb out by paying for perturbed restarts at the far end of the
budget; so use many starts.* That argument is correct and the measurement behind
it (`cluster-seed.ts`'s −3.97 cells of head separation, 46 → 220 collision
deaths) is unambiguous. But the literature says something more specific about
*what kind* of many-starts, and we should encode the specific version.

### 2a. What we built is Bet-and-Run, and it is a good structure

The precise name for stages 0+1 is **Bet-and-Run** (Fischetti & Monaci; Friedrich,
Kötzing & Wagner, arXiv:1609.03993; Weise, Wu & Wagner, arXiv:1806.08984):
start `k` independent runs for a short budget `t₁`, apply a decision maker `D`
to pick `m` of them, then spend the remaining `t₃` on those.

Our parameters, read off `DEFAULT_MULTISTART`:

| Bet-and-Run | ours |
|---|---|
| `k` | up to `maxSamples: 4096` per cluster (sized from `budgetFraction: 0.1`, `maxBudgetMs: 120`, `evalsPerMs: 600`) |
| `t₁` | `climbSteps: 2` coordinate-ascent passes per sample |
| `D` | softmax over the pool at temperature `t₀ = 0.25` cooling by `gamma: 2` to `tMin: 0.02` |
| `m` | 1 |
| `t₃` | the remaining ~90% of the decision: the full ascent + enumeration + depth |

That is a faithful, well-shaped instance, and the structure is right. Two
calibration findings follow directly from the literature.

> **Finding P-1 (the decision maker).** Weise, Wu & Wagner tested learned and
> fitted decision makers against the trivial one and concluded: *"the
> currentBest method is a very reliable and robust baseline approach."* Our `D`
> is currentBest **with noise added**, by the owner's weighted-random ruling.
> That deviation is defensible on other grounds (exploration order, mirror
> breaking, anti-determinism against a copy of ourselves), but it should be
> recorded as a deviation from the robust baseline rather than as the
> literature's recommendation, and its cost is measurable: at `tMin = 0.02` the
> draw is essentially argmax, at `t₀ = 0.25` it is not.

> **Finding P-2 (the temperature is denominated in an absolute currency).**
> `t₀ = 0.25` is in **weight units**. So the draw's character depends entirely
> on the *gap scale between pool members on this board*, which nobody has
> measured. If typical gaps are ~1 weight unit, `exp(1/0.25) ≈ 55:1` and the
> softmax is argmax. If typical gaps are ~0.05 — which is what a quiet board's
> near-ties look like — the draw is nearly uniform over 512 pool entries.
> **The same constant is therefore a different policy on every board class**,
> and the direction of the difference is the wrong way round: it explores most
> where the options are indistinguishable and least where they differ. The
> standard remedy is to normalise: temperature as a fraction of the pool's own
> spread (a Boltzmann draw over `(v − max) / spread`), which makes one number
> mean one thing everywhere. This is a Ruling-49 case in miniature — a fitted
> constant whose provenance is a board class nobody wrote down.

### 2b. What the literature says we are missing: the incumbent is thrown away

The deepest result in the multi-start literature is about *where new starts come
from*, and the answer is not "uniformly at random". Boese, Kahng & Muddu's
adaptive multi-start (1994) established the **big-valley** structure of
combinatorial landscapes — good local optima are clustered near each other and
near the global optimum — and the consequence: **new starts built from
components of previously found good solutions beat uniform random restarts**,
often by a wide margin. That line runs through GRASP with path relinking,
iterated local search, and ruin-and-recreate / large neighborhood search.

So the seeding sub-joint's members are naturally **indexed by how much of the
incumbent they keep**:

| member | keeps | our status |
|---|---|---|
| **uniform random restart** | nothing | stage 0/1 (dark) |
| **constructive greedy** | nothing, but biased | `cluster-seed.ts` — **rejected on measurement**, and correctly |
| **ILS kick** | all but a few units | `perturb`: 1 unit, deterministic, `restarts: 2` |
| **LNS / ruin-and-recreate** | all but one *related* subset, re-optimised **exactly** | **absent** (doc 02 §5 shows the machinery exists) |
| **path relinking** | a trajectory between two elite solutions | absent; needs an elite pool, which stage 1's `poolCap: 512` already is |

Reading down that column: we have the two ends of the axis and neither middle.
And the two ends are the two the literature likes *least* for a big-valley
landscape.

> **Finding P-3.** The redesign correctly diagnosed "one seed is one basin" and
> correctly rejected the constructed seed, but the remedy it chose — uniform
> random multi-start — is the member the literature recommends when basins are
> *disjoint and uninformative about each other*. Our landscape is the opposite:
> the measurements in `multistart-seed.ts`'s own header (separation, wall
> distance, collision cause counts all moving together) describe a landscape
> with strong global structure, i.e. a big valley. On such a landscape uniform
> restarts are *the safe member, not the strong one*: they cannot be trapped,
> and they also cannot exploit. The strong members are the middle rows, and the
> middle rows are exactly what a 1-opt ascent with a 1-unit kick cannot express.

That is not an argument to undo the redesign. Stage 0's *"no systematic spatial
preference at all"* is the right answer to formation pinning, and it should
stay. It is an argument that stage 0 solves the **bias** problem and does not
solve the **escape** problem, and the escape problem is what the corridor
lock-in hypothesis in `brief-q5.md` describes:

> *"escaping that requires two or three units to swap intentions in the same
> turn, which single-unit ascent steps cannot express."*

Two or three units swapping intentions is an **ejection chain** (Glover), and
that is the missing operator. See §4.

### 2b½. Finding P-8: the multi-start uses the partition's components and discards the conditioning order that makes the partition sound

This one is specific and I think it is a real defect, not a trade.

`cluster-partition.ts` justifies the slider fiat by the star structure and states
the operation exactly:

> the interaction graph is a STAR whose hub is a slider 89.7% of the time.
> Lifting the hub out of the residual graph and **CONDITIONING on it** is the
> same operation as the owner's fiat.

and `cluster-enum.ts` honours that: sliders are the **outer** coordinate, and
every component is solved **conditional on** each slider joint —
*"Condition, never marginalise: that is what keeps two clusters' proposals
commensurable."*

The multi-start seed does the **opposite order**, and nothing says so.

- `core.ts:1623` passes `clusters: state.partition.clusters.map(c => c.members)`
  — **`members`, not `variables`**, so the sliders are not in any cluster group.
- `groupsOf` walks those groups, marks slots `taken`, and puts **everything left
  over into one trailing `rest` group** — which is exactly the sliders.
- `multiStartSeed`'s stage-1 loop is `for (let g = 0; g < groups.length; g++)`
  with `trial.set(working)` at the top of each sample and
  `working[slot] = chosen.choice[slot]` at the bottom of each group. So groups
  are **sequential and committing**: group `g+1` is conditioned on `g`'s chosen
  assignment.

Put together: **every component is optimised against the sliders' stage-0
random safe draw, and only then are the sliders optimised against the resulting
components.** The hub is conditioned on *last*, which is the one order cutset
conditioning exists to avoid — on a star, conditioning on the hub last means
every leaf was optimised against a hub position nobody chose.

Three things make this worth fixing rather than noting:

1. **The fix is a reordering, not a redesign.** Emit the `rest` group first (or
   have the caller pass slider slots as group 0). Then components are sampled
   conditional on a *chosen* slider assignment, which is the enumeration's own
   order. One line in `groupsOf`.
2. **A stronger version is already affordable.** The enumeration explores
   `maxSliderBranches` slider joints as outer coordinates. The seed could sample
   a small number of slider assignments and run the component groups under each,
   picking among the completed joints — a two-level bet-and-run whose outer level
   is the hub. That is the same shape as `enumerateProposals`, at surrogate cost.
3. **It interacts with the rejection this module exists to answer.** The
   rejected `cluster-seed.ts` failed as *"a committed greedy argmax that builds
   ONE joint assignment, unit by unit, each choice constraining the rest"*. The
   multi-start correctly stopped doing that **within** a group — the whole
   sampling apparatus is there — and still does it **between** groups, at the
   level where the coupling is strongest, because that is where the sliders are.
   The sampling fixed the unit-level commitment and left the cluster-level one
   in place.

> **P-8 as a joint statement.** Group **order** and group **conditioning** are
> members of the DECOMPOSITION joint's `focus` sub-joint (doc 02 §4c) applied to
> the seed rather than to the enumeration. That is the argument for the two
> layers sharing one `Decomposition` value instead of each deriving its own: they
> currently derive the same partition twice (`openMultiStart` and `openCluster`
> both call `partitionOf`) and then use it in opposite orders.

### 2b¾. Finding P-9: the sample count is sized from TIME and never from the size of the space

`multiStartSeed` sizes each group's sample count like this:

```ts
const totalEvals   = Math.max(1, Math.round(req.budgetMs * tuning.evalsPerMs))
const perSample    = 1 + tuning.climbSteps * optionSlots
const share        = Math.floor((totalEvals * vars.length) / units.length / perSample)
const budgetSamples = Math.min(tuning.maxSamples, Math.max(tuning.minSamples, share))
```

There is **no term for how many distinct assignments the group actually has.**
The pool de-duplicates on `comboKey` and `admit` early-returns on a repeat, so
once the pool holds every distinct combo, every further sample is drawn,
climbed, scored — and discarded.

The group's distinct-combo count is exactly `∏_v |choose_v|`, which is small:
`choose` is capped at `candidateCap` and 88.7% of components are singletons.

At the shipped defaults (`budgetFraction: 0.1`, `maxBudgetMs: 120`,
`evalsPerMs: 600`, `climbSteps: 2`, `poolCap: 512`, `maxSamples: 4096`) on a
one-second turn, `totalEvals = 60 000`:

| group shape (6 free units) | evals/sample | samples drawn | distinct combos | evaluations that bought nothing |
|---|---|---|---|---|
| singleton, 5 options | 11 | **909** | **5** | ~9 900 |
| singleton, 8 options | 17 | **588** | **8** | ~9 900 |
| pair, 5 options each | 21 | **952** | **25** | ~19 500 |
| triple, 5 options each | 31 | **967** | **125** | ~26 100 |
| slider rest-group of 3, 8 each | 49 | **612** | 512 (pool cap binds) | ~4 900 |

> **Finding P-9.** On a scattered board — the 88.7% case — the multi-start's
> stage 1 draws roughly nine hundred samples per group over a space of five to
> eight distinct assignments. Across five or six singleton groups that is on the
> order of **fifty thousand of the sixty thousand budgeted evaluations spent
> re-drawing assignments already in the pool.** The layer's own header states the
> requirement it violates: *"the whole point of a cheap multi-start is that it
> runs BEFORE the expensive machinery and leaves that machinery its budget."*

Three honest qualifications, because the finding should survive scrutiny:

1. **The waste is denominated in evaluations, and whether it converts to wall
   time depends on `evalsPerMs: 600`.** That constant is a *conversion rate*
   chosen to be conservative ("over-estimating the cost spends less than the
   slice"). If the true rate is higher, the loop finishes early and hands time
   back; if lower, the `CLOCK_STRIDE` backstop truncates at the deadline. Either
   way the *evaluations* bought nothing, and `evalsPerMs` is itself an
   unprovenanced fitted constant — a second Ruling-49 case in this module beside
   the temperature (Finding P-2).
2. **The pool's first-come-capped policy is NOT the problem and the comment
   defending it is right.** Samples are i.i.d. draws from the
   uniform-over-safe-options distribution followed by a climb, so the first 512
   distinct ones are an *unbiased* sample of that distribution; evicting the
   worst would indeed be "a deterministic filter wearing a lottery's clothes"
   and would break the prefix property. The defect is the absence of a **stopping
   rule**, not the presence of an ordering.
3. **The layer is dark by default** (`multistartSeed: undefined → false`), so
   this is not costing production today. It is costing the *redesign the owner
   ruled binding*, and it would land the moment the flag is seated.

**The fix is two lines and it is a pure win.**

```ts
let space = 1
for (let v = 0; v < vars.length; v++) space *= opts[vars[v]].choose.length
const budgetSamples = Math.min(tuning.maxSamples, tuning.poolCap, space,
                               Math.max(tuning.minSamples, share))
```

plus an early exit when `k` consecutive draws produce no new pool entry (which
also handles the case where the climb makes the reachable set smaller than
`space`). And critically: **hand the unspent budget back** rather than letting
the clock stride consume it — the module's stated contract is to leave the
ascent its budget, and on 88.7% of boards it could return nearly all of it.

> **P-9 as a joint statement.** This is the PROPOSAL joint's `cost(state)` method
> missing. An operator that cannot say what it will cost *given the state* gets
> its budget from a clock, and a clock does not know that a five-point space has
> been exhausted. Every one of the nine constants in §5 has this shape; this is
> just the one where the gap is arithmetically visible.

### 2c. Restart *timing*, which nobody has considered

Luby, Sinclair & Zuckerman's result is that when a randomised search has a
heavy-tailed runtime distribution, restarting is not merely helpful — the
universal schedule `1,1,2,1,1,2,4,1,1,2,4,8,…` is optimal to within a constant
factor without any domain knowledge, and it *eliminates* the heavy tail. Our
`restarts: 2` is a fixed count consumed at the end of the loop when
`best === before`. Whether our decision's improvement process is heavy-tailed is
an empirical question with a free answer: the mechanism report already records
`slices`, `improveCalls` and the plan history, so the distribution of
"slices until the last accepted improvement" is derivable from existing logs.

> **Finding P-4.** If that distribution is heavy-tailed, a Luby-scheduled
> restart of the *whole ascent* (cheap: the bank's witnesses and the evaluation
> memo survive a restart by construction, so a restart costs the sweep and not
> the pricing) dominates the current fixed `restarts: 2`. If it is not, `restarts`
> should be 0 and the budget should go to operators 4 and 6. Either answer
> removes a constant. The measurement needs no new instrument.

## 3. Law P1 — the admission law (from the prior-art lens, adopted)

This is the sharpest thing either lens has said about the candidate layer and it
belongs here as a law of the proposal joint:

> **Law P1.** Every restriction of a unit's option set must be **adaptive on
> value** OR **carry a bound on what it removed**. A value-blind fixed-rank
> prefix is neither.

The comparison that makes it a law rather than an opinion:

| system | how it restricts a combinatorial action space | adaptive? | bounded? |
|---|---|---|---|
| **Double oracle** (Bosanský et al.) | adds the **best response** to the restricted game each iteration; terminates with a **value-gap certificate** | yes | yes |
| **CMAB / NaiveMCTS** (Ontañón, RTS) | per-variable bandits on **realised reward**; regret bounds | yes | yes (in expectation) |
| **Hierarchical Portfolio Search** (Churchill & Buro; shipped in *Prismata*) | restricts to a **portfolio of named scripts**, so the removed set is exactly "everything no script would do" — a stated, inspectable claim | no | yes (by construction) |
| **ours: `candidateCap: 8`, `sliderCandidateCap: 4`** | the first `n` by the candidate layer's heuristic comparator | **no** | **no** |

`domainOf` is explicit — `for (let i = 0; i < limit; i++)` over `set.candidates`
— and the enumeration's slider cap of 4 cuts a queen's ~71 options to its first
four by a hand-written twelve-slot lexicographic comparator that the composition
lens has separately shown is **weight-blind** (`captureRank` ranks a weight-31
queen capture identically to a weight-2 snake).

Three things are true at once and all three should be said:

1. **The code's own defence is correct as far as it goes.** `domainOf`'s comment
   — *"NEITHER IS A PRUNE. The candidate sets are untouched; this narrows what
   the PROPOSAL GENERATOR ranges over, which is a max-side restriction on our
   own search order and needs no declaration"* — is exactly right about
   *soundness*. A max-side restriction cannot make a floor unsound.
2. **And it is silent about capability**, which is the whole question. Law D1
   (doc 02) says the same thing about decomposition: generation has no soundness
   obligation, only a coverage one. `sliderCandidateCap: 4` is a coverage
   decision presented as a soundness non-event.
3. **The CL4 lottery is a partial answer and its own comment says where it
   stops.** `optionsOf` samples where the cap binds and takes the prefix where it
   does not — *"exact where complete, sampled where truncated"* — which is right,
   and it was measured: *"sampling every unit's order cost 17→22 fatal stagings
   at q=8 and bought exactly zero far options, because there were none to buy."*
   But a Gumbel draw over a **rank prior** is still value-blind; it changes
   *which* 8 of 71, not *whether the choice used any information about the
   board*. Under Law P1 it is a better member than the prefix and still not a
   passing one.

> **Finding P-5.** The passing members of Law P1 already exist in the codebase in
> other places. The bank's B1 rung refuses to move a floor on a truncated sweep
> — that is a bound on what truncation removed. The scout's `ourMiss` /
> `theirMiss` charge un-enumerated space to precision — that is also a bound.
> **The candidate layer is the one place where a truncation is taken and nothing
> is charged for it.** The cheapest passing member is therefore not a new
> algorithm but the existing pattern applied one layer down: **charge the cap.**
> Emit `1 − admitted/available` per unit per decision, and (once the reduction
> is non-vacuous, doc 01 R2) fold it as ambiguity in the same way `theirMiss`
> is folded. A unit whose options were cut 71 → 4 then produces a *wider*
> value, which is both honest and, usefully, self-correcting: the search stops
> preferring plans whose options it did not look at.

And the portfolio member deserves naming because it is cheap and it is shipped
elsewhere: **HPS restricts to what a small set of named scripts would do.** We
have the scripts — the candidate layer's orderings *are* scripts (safest,
capture-first, food-first, spread) — and taking one option from each is a
value-blind restriction with a *stated* removed set, which passes Law P1's second
clause where a rank prefix passes neither. It is also the member that most
directly answers the weight-blindness finding, because a portfolio of orderings
is exactly a way to stop one comparator's blindness from being total.

> **Note on our fallback ladder, from the prior-art lens.** `cluster-enum`'s
> above-budget rungs are threshold-split and ICM — greedy per-unit improvement
> on the surrogate. That is **Portfolio Greedy Search** (Churchill & Buro), the
> RTS baseline the subsequent literature exists to beat. Our *exact* rung is
> stronger than anything in that family (doc 02 §3ii); our *fallback* is its
> weakest member. So the ration that decides which rung fires is more
> consequential than it looks, and `ClusterStats.{rungThreshold, rungIcm}` is
> the right thing to be watching.

## 4. The missing operator: conflict-chain repair

`pairRepair` is 2-opt over the pairs the resolver names. `jointPolish` is
exhaustive over ≤3 units × top-2. The corridor lock-in hypothesis needs
"two or three units to swap intentions", and the escape from an interlocked
formation is generally a **chain**: A wants B's cell, so B must move, which
takes C's cell, so C must move…

That operator is an **ejection chain** (Glover), it is the standard escape for
exactly this landscape, and its cost is **linear in chain length** where the
polish's cross-product is exponential in block size:

```
seed  ← a unit the resolution names as a casualty
loop  ← re-assign it to its best option; if that option displaces a teammate,
        that teammate becomes the next link; stop at depth d or when no
        displacement occurs
price ← ONE bank call on the whole chain's joint reassignment
```

A depth-5 chain costs 1 price. A 5-unit polish block at top-2 costs 32. The
conflict graph the chain walks already exists: `ConflictIndex` and
`subStepsFor` are built for the enumeration and the multi-start seed.

> **Finding P-6.** The three multi-unit escape operators we have —
> `pairRepair` (2), `jointPolish` (≤3), `perturb` (1, deterministic) — are all
> *bounded-size block* operators, and their cost grows exponentially in the size
> of the coordination they can express. The one shape whose cost is *linear* in
> the coordination size is the chain, and it is precisely the shape the failure
> hypothesis names. This is a small, self-contained build with an existing
> falsifier: the multi-start's own regression test (*"from a packed corner
> spawn, the multi-start seed must not compress own-team separation the way the
> cell-claim seed did"*) generalises directly to "from a locked corridor
> formation, the chain repair must recover separation within N slices".

## 5. The joint

```ts
/** One proposal operator. Every member of the PROPOSAL joint is one of these. */
interface ProposalOperator {
  readonly id: OperatorId
  /** How much of the incumbent it keeps — the literature's real member axis. */
  readonly retention: 'none' | 'all-but-k' | 'all-but-subset' | 'trajectory'
  /** What it costs, in the time lens's currency (resolution-equivalents). */
  cost(state: AscentState): Quanta
  /** The proposals themselves. Never a value, never a set restriction. */
  propose(state: AscentState, budget: Quanta): Iterable<JointPlan>
}

interface ProposalPolicy {
  readonly operators: ReadonlyArray<ProposalOperator>
  /** WHICH operator spends the next quantum. Members: fixed-order (today,
   *  hard-coded in `improve`), round-robin, bandit-over-realised-gain. */
  readonly schedule: (state: AscentState) => OperatorId
}
```

Two laws:

> **Law P2 (proposals are proposals).** A `ProposalOperator` may not read or
> write a bound, may not restrict any candidate set, and may not adjudicate.
> Every plan it yields is priced by the unconditional bank and accepted only by
> `better()`. *(This is Law D1 generalised from decomposition to every operator,
> and the scout's existing import-law test is the enforcement pattern.)*

> **Law P1 (admission is adaptive or bounded).** §3.

And one structural claim: **the `schedule` field is where the real design
question is, and it is currently a hard-coded sequence inside `improve`.**
The order is: enumeration offers → sweep → enumeration offers → pair repair →
(on convergence) polish → perturb restarts. Each step's budget is a constant
(`clusterOffersPerRound: 1`, `clusterOffersPerSlice: 2`, `maxSweeps: 6`,
`restarts: 2`). Nothing measures which operator produced the accepted trial.

> **Finding P-7.** `adjudication` counts *which rung decided*; nothing counts
> *which operator proposed the winner*. One field on `BankResult` (or a
> `proposedBy` tag threaded through `price`) turns the whole operator table into
> a measured object, makes the bandit schedule buildable, and answers the
> question the composition lens keeps hitting from the other side — *which of
> these members is doing any work?* It is the single cheapest instrument in this
> document and it is a prerequisite for every adaptive schedule.

## 6. Contradictions and cross-lens asks

### C-J3 — "no joint with one member" is violated by the operator list being invisible

The composition lens's chief refusal is *"no joint with one member. A collection
of one is a constant wearing a socket's clothes."* By that standard the proposal
layer is worse than a one-member joint: it is an **eight-member joint with no
socket at all**, hard-coded as a control-flow sequence with eight constants. The
members exist, are individually well-argued, and are collectively unaddressable.
That is the same defect their finding 7 names for `CandidateKnobs` ("three kinds
in one bag"), one layer up, and it should appear in their inventory.

### C-T3 — operator budgets are constants where the time lens has a currency

`clusterOffersPerRound`, `clusterOffersPerSlice`, `maxSweeps`, `restarts`,
`pairRepairPerUnit`, `polishUnits`, `polishPerUnit`, `stage0Attempts`,
`climbSteps` are nine constants that all answer one question: *how much of this
slice does operator X get?* The time lens has exactly the right vocabulary for
that (`allowance split across phases … unifying the scout's tithe/reserve, the
kernel's speculativePeriod, and the unbuilt ponder-window policy into one
table`) and their table currently covers the *layers* but not the *operators
inside the search layer*. **Ask: does the allowance split table have a row per
proposal operator, or only per layer?** If only per layer, the nine constants
survive the refactor and the search remains the one place with un-priced
sub-budgets.

### C-V2 — the temperature and the value lens's currency (VALUE lens)

Finding P-2's remedy (normalise the softmax temperature by the pool's spread)
interacts with the value lens's common-currency result. If score decomposes into
three weight-share-folded flows with `k ≈ 1.2`, then the *spread* of a pool of
candidate plans has a predictable scale on a given board, derivable from the
flow magnitudes. So the normalisation constant may not need to be measured
empirically at all — it may be computable, in the same way they argue `room: 3`
should be the derived coefficient `(K/W)(1−p)·w_u` rather than a knob. **Ask:
does the folded-weight model predict the spread of a candidate pool, and not
just the level of a plan?** If yes, `t₀` becomes derived and one more fitted
constant goes away.

### C-B3 — stage 0's safety draw and the belief lens's support (BELIEF lens)

Stage 0 draws uniformly over *provably-safe* moves, where safety comes from
`certainlySelfFatal` and `allyBodyCollision` — deductions on the current board.
Under fog, "provably safe" is a statement about the support `S`, and it shrinks
as clouds dilate: a move safe against a known enemy is not safe against a
saturated cloud. So stage 0's draw domain is a projection of `S`, and on a
heavily fogged board it can empty — at which point the code falls back to the
joint-combo draw and then to "a rules-certain death is only ever staged for a
unit that has no other option at all". **That degradation ladder is correct and
should be listed in the belief lens's projection table**, because it is a ninth
projection of `(S, w)` that their inventory of nine does not include: *the safe
action set*.

## 7. Build order

| # | increment | cost | what it decides |
|---|---|---|---|
| **P0** | `proposedBy` on every priced trial; report accepted-trial counts by operator (Finding P-7) | one tag | which of the eight operators does any work. Prerequisite for everything adaptive, and it will probably retire two of them outright |
| **P1** | measure the gap-scale distribution in the multi-start pool and normalise `t₀` by spread (Finding P-2) | analysis + one line | removes a constant whose meaning varies by board class |
| **P2** | charge the candidate cap: emit `1 − admitted/available` per unit; do not yet fold it (Finding P-5) | one counter | makes Law P1's violation visible per board class, which is what decides whether the slider case is a real capability loss or a 98.9%-inert ration like `maxClusterCells` |
| **P0½** | **bound `budgetSamples` by the space** (Finding P-9): `min(maxSamples, poolCap, ∏\|choose_v\|, max(minSamples, share))`, plus a no-new-entry early exit, plus **returning the unspent budget** | two lines | nothing to decide — it is a pure win, and on 88.7% of boards it hands most of a 100 ms slice back to the ascent. Do it before the flag is ever seated |
| **P2½** | **hub-first group order** in `groupsOf` (Finding P-8) — emit the slider group before the components | one line | whether the seed's cluster-level conditioning order matters. Falsifier: the multi-start's own separation regression test, on a slider board rather than a trail board |
| **P3** | **conflict-chain repair** as an eighth operator (§4) | small, self-contained, existing `ConflictIndex` | the corridor lock-in hypothesis. Falsifier already written (the multi-start's separation regression test, generalised) |
| **P4** | seat the dark operators: `multistartSeed` and `sampledCap` get roster bots (the composition lens's reachability law) | config | they are built, argued and unmeasured |
| **P5** | derive the restart schedule from the measured improvement-time distribution (Finding P-4); Luby if heavy-tailed, `restarts: 0` if not | analysis | removes another constant |
| **P6** | the `schedule` sub-joint with a bandit over realised gain — **only after P0** | medium | — |

P0 is the gate. Eight operators, nine constants, and no record of which one
proposed the plan we staged: that is the state of the layer that decides what
the bot plays.
