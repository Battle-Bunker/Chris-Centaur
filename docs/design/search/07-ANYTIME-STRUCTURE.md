# 07 — Anytime structure: what our search promises about being interrupted, and what prefix determinism costs

SEARCH-THEORY lens, document 7. Two threads that belong together because both are
about *the shape of the search over time* rather than over the board.

1. Our kernel is a **composition of anytime algorithms** with a large
   non-interruptible prefix, which is a solved problem with a known optimal
   overhead — and the frame supplies the missing half of contradiction C-T2.
2. **Prefix determinism** is a strong invariant maintained at real cost across at
   least six sites, for the benefit of one analysis whose output this program's
   own critic discounted. It should be priced, and the way to price it is the
   reachability law applied to an invariant.

---

## 1. The anytime vocabulary, and where we sit in it

Russell & Zilberstein (1991) split anytime algorithms in two:

- a **contract** algorithm must be told its allocation in advance; interrupted
  early it has nothing useful to return;
- an **interruptible** algorithm can be stopped at any moment and returns an
  answer whose quality its **performance profile** describes.

Two results matter here.

**The conversion is cheap and the constant is tight.** Any contract algorithm
becomes interruptible by iterative doubling of contract lengths, with
**acceleration ratio at most 4** (Russell & Zilberstein 1991), and Zilberstein,
Charpillet & Chassaing (2003) proved 4 is **optimal** — no scheduling strategy
over any set of contracts does better. So "this component is a contract
algorithm" is never a reason to give up interruptibility; it is a reason to pay a
bounded, known price.

**Composition needs performance profiles.** Zilberstein & Russell's
*Optimal composition of real-time systems* (AIJ) solves two problems: making the
composed system interruptible (a general construction with a small constant
penalty), and **allocating time optimally among the components** — which requires
each component's profile. Local compilation yields global optimality for a large
class of program structures.

That second sentence is the one that names our gap.

## 2. What the enumeration is, in that vocabulary

`clusterOf` / `openCluster` is documented with an unusually clear measurement:

> *"The price is FIXED — 343 / 311 / 326 ms at turn budgets of 500 / 1000 /
> 2000 ms — so it is a setup toll paid before the anytime kernel starts thinking,
> not slow thinking. At a 500 ms budget it ate the whole turn: every one of the
> 100 missed deadlines in that cell was a decision still waiting for its FIRST
> plan."*

A cost that does not fall when the budget falls is the signature of a
**non-interruptible prefix**. An anytime algorithm with a prefix of length `c`
has quality zero for all `t < c`, which is exactly what "every missed deadline
was a decision still waiting for its first plan" describes.

**The fix that was applied is the textbook one, and it is worth recognising as
such.** Moving the enumeration off `conform` and into the first refinement slice
— *"the cheap legal plan is staged first, and the enumeration then refines it
under the normal anytime discipline"* — is precisely the standard construction:
guarantee a useful answer exists before the non-interruptible prefix runs. That
is the "small constant penalty" composition, discovered by measurement.

What remains is that the enumeration is only *partly* interruptible, at two
granularities, and both are coarse:

- `STOP_STRIDE_MASK = 63` gives leaf-level interruption **inside** one cluster's
  exact walk (one deadline read per 64 leaves);
- `enumDeadline` gives cluster-level interruption **between** clusters (*"when it
  fires the rest of the partition keeps the seed's assignment and the pass
  returns what it has"*).

But the **setup** — `partitionOf`, `domainOf` over every variable,
`subStepsFor` over every path, the `Surrogate`'s pair tables — is not
interruptible at all, and on a slider board it is where the time goes
(`reachOf`'s measurement: 4.23 ms per cluster joint on `snake5-queen` against
0.42 on `snake5-knight`, because every pair-table cell walks the whole ray).

> **Finding A-1.** The enumeration's *search* is interruptible at two
> granularities and its *setup* is not interruptible at all. The setup's cost is
> superlinear in slider reach, which is the board class where it is also most
> valuable. Nobody has measured the split between setup and walk, and the two
> want different remedies: the walk wants a finer stride, the setup wants
> incrementality (build the pair table for the cluster you are about to solve,
> not for all of them).

## 3. Finding A-2: we have a recognizable quality measure and have never plotted it

Zilberstein's checklist of properties a well-behaved anytime algorithm should
have includes **measurable quality**, **recognizable quality** (the algorithm can
tell how good its current answer is, *without* knowing the true optimum),
**monotonicity**, **diminishing returns**, **interruptibility** and
**preemptability**.

We score unusually well on the hardest of those, and the reason is the bounds
layer:

| property | us |
|---|---|
| measurable quality | yes — score is in weight units |
| **recognizable quality** | **yes, in the strong form.** `bounds.worst` is a *proved* lower bound on the current answer's value, and `bounds.best` an upper one. Most anytime algorithms have to estimate their own quality; we can bound it |
| monotonicity | yes, and enforced — the kernel's ratchet refuses any staging with `lo < basis.floorLo` |
| diminishing returns | unmeasured |
| interruptibility | yes at the kernel level, partial in the enumeration (§2), and the wire always holds a legal plan |
| preemptability | yes — `abandoned?.()` and the epoch machinery |

And the recognizable-quality measure is a specific existing quantity:

```ts
const gap = Math.max(0, hi - value)      // kernel.ts::stageAndGate
if (gap > basis.maxGap) { refusals["ratchet-gap"]++; return null }
```

`maxGap` is monotonically non-increasing within a basis by the ratchet's own
rule. **That is a performance profile's y-axis, already computed, already
monotone, already enforced — and it is never plotted against time.**

> **Finding A-2.** `basis.maxGap` is simultaneously (a) the anytime quality
> measure the composition problem needs, (b) the hand-built scalar proxy for the
> shrinking option set that Γ-maximin refuses to produce (doc 01 §8a), and
> (c) the ratchet's enforcement variable. One quantity, three roles, and it has
> never been reported as a function of elapsed time.

The instrument is trivial: emit `(t, maxGap)` pairs per decision, or just
`maxGap` at each emission alongside the timestamp the record already carries.
Over a replay corpus that is the conditional performance profile — conditioned on
board class, which the corpus already labels.

Two things it would immediately settle:

1. **Diminishing returns.** If `maxGap(t)` flattens well before the deadline, the
   remaining budget is worth nothing on that board class and the time lens's
   allowance should go elsewhere (or the turn should end early, which the
   `abandoned` path already supports).
2. **C-T2, quantitatively.** The enumeration's ration is currently a fixed turn
   fraction (`tuning.budgetFraction`). With profiles for "kernel with
   enumeration" and "kernel without", the allocation stops being a constant and
   becomes the standard composition calculation. That is the missing half of the
   contradiction: I said the enumeration should be *a bidder in the hypothesis
   market*; the profile is *what it bids with*.

> **Cross-lens ask (TIME), sharpened.** Their hypothesis market allocates
> allowance grants between competing uses. Zilberstein's composition result says
> optimal allocation among anytime components requires each component's
> performance profile, and that **local** compilation gives **global** optimality
> for a wide class of structures — which is exactly the property that makes a
> market work rather than merely look tidy. **Does the market's bid type carry a
> profile, or only a scalar?** A scalar bid cannot express "I improve fast for
> 40 ms and then flatten", which is the shape the enumeration almost certainly
> has.

## 4. Pricing prefix determinism

### 4a. The invariant, and where it is paid for

The property, as the code states it in several places: **a bigger budget's
decision sequence is an EXTENSION of a smaller one's.** Six sites maintain it,
each at a cost, and each says so:

| site | what it gives up |
|---|---|
| `multistart-seed.ts::admit` | **elite pooling.** *"A pool that evicted its worst member would be a deterministic filter wearing a lottery's clothes, and it would also break the prefix property: a smaller budget's pool must be a PREFIX of a bigger one's."* So the pool is first-come-capped at 512 rather than best-512 |
| `core.ts::nextSweepOrder` | draws must be **peeked, not consumed**, so the worker cut cannot advance the stream — extra machinery on a hot path |
| `core.ts::improve` | the sampler's temperature is read **once per slice** *"so the step-clock replay stays a function of the slice count and not of how much sampling happened inside a slice"* |
| `core.ts::enumDeadline` | the enumeration may not read the **slice** clock and must ration off `decisionFraction`, *"which is what keeps every deterministic probe a function of call count"* — and that ration is therefore blind to the partition (C-T2) |
| `scout.ts` (the Scout lives for the session) | *"a ledger rebuilt every slice would restart every counter and destroy the property that a bigger budget's decision sequence is an EXTENSION of a smaller one's"* |
| `core.ts::offerOrder` | the proposal permutation is computed **once**, at enumeration time, and never revisited — which is also why `focus` is stuck at its null member (doc 02 §4d) |

Plus a seventh in flight: the TIME lens is proposing to convert wall cuts inside
work into **counting cuts** specifically to strengthen this property.

That is a lot of design pressure from one invariant, and it has never been
written down as an invariant with a name — it exists as six comments that each
independently justify a local choice.

### 4b. What it actually buys, stated precisely

Two different properties are easy to conflate and only one of them is expensive:

- **Run determinism**: same `(seed, board, budget)` ⇒ same decision. Buys replay,
  debugging, the differential gates, and mirror-breaking against a copy of
  ourselves. **Cheap** — it needs seeded streams and no clock reads inside work.
- **Prefix determinism**: the 100 ms decision's sequence *extends* the 10 ms
  decision's. Buys exactly one thing: a **paired** comparison across budgets, in
  which the difference between two budgets is attributable to the extra work
  rather than to a different random walk. **Expensive** — it is what the six
  sites above are paying for.

Run determinism is not in question. Prefix determinism is the one to price.

### 4c. Finding A-3: the consumer of the expensive half is not in good health

The one analysis prefix determinism exists to serve is the anytime curve — the
comparison of a decision at 10 ms, 100 ms, 1000 ms. This program's own critic
audit records how that analysis went:

> *"anytime curves n=45 quantized, 10→100 ms gains = 1 decision, 1000 ms column
> dropped, RR vs anytime disagree 54 pts for anytime-kernel"*

and separately:

> *"anytime-kernel 10 ms INVALID (module-scope cost latch; uncontended same
> budget = 95.6% optimal; 10.9→43.1 jump = the latch, not compute)"*

So: the headline anytime findings were quantized past readability, one budget
column was dropped, one arm's curve was invalidated by a caching artifact rather
than by anything the property protects, and a rank-based reading disagreed with
the anytime reading by 54 points on the very bot the property is most elaborate
in.

> **Finding A-3.** Prefix determinism is maintained across six sites at real
> cost, and its single consumer produced findings the program's own critic
> discounted. That is not an argument that the property is wrong — it is an
> argument that **nobody has checked whether its consumer is alive**, which is
> exactly the question the composition lens's reachability law asks about
> members.

### 4d. The proposal: Law R for invariants

The composition lens's chief structural rule is that **every member must be
reachable from a roster bot; the two remedies are seat it or delete it, and there
is no third state.** An invariant maintained across six sites is at least as
expensive as a member and is currently in the third state — nowhere named,
nobody's, unmeasured.

> **Law I (invariants are addressed like members).** A cross-cutting invariant
> maintained at more than one site must be **named once**, **listed with its
> sites**, and **attributed to a consumer that a live analysis or test
> exercises**. The two remedies are the same two: give it a consumer, or stop
> paying for it.

Applied here, that yields three concrete asks rather than an opinion:

1. **Name it.** One `docs/` entry, or one exported symbol
   (`PREFIX_DETERMINISM.sites`), listing the six.
2. **Give it a test.** A property test that runs one decision at budget `b` and
   at `2b` under one seed and asserts the emission sequence at `b` is a prefix.
   That test does not exist, and without it the invariant is a convention six
   comments believe in. It is also the cheapest possible check: the
   `countingBudget` in the testkit already exists precisely so a budget can be
   expressed in call counts.
3. **Then decide, per site, whether the price is worth it.** With the invariant
   tested, relaxing it *at one site* becomes a measurable change rather than a
   frightening one. The site I would examine first is the multi-start pool: elite
   selection over 4096 samples is strictly better than first-come over 512, and
   the prefix property is being paid for there in *search quality* rather than in
   machinery.

### 4e. And one place where the property may be buying less than it seems

Prefix determinism gives a paired comparison **for a fixed seed**. But the
quantity a performance profile needs is a *distribution* of quality over time,
which comes from many seeds — and prefix determinism neither helps nor hinders
that: you vary the seed across replicates either way.

So the property's value is concentrated in one use — reading a *single* decision
at two budgets and attributing the difference to work — which is a debugging and
explanation tool, not a measurement tool. That is a genuinely useful thing to
have. It is not obviously worth six sites and a forfeited elite pool, and the
question has never been asked.

## 5. Build order

| # | increment | cost | what it decides |
|---|---|---|---|
| **A0** | emit `maxGap` with each emission's timestamp; plot the conditional performance profile per board class from the replay corpus (Finding A-2) | one field, then analysis on existing replays | diminishing returns, and it turns C-T2's allocation from a constant into a calculation. Also gives the anytime curve a quality axis that is *proved* rather than estimated |
| **A1** | split the enumeration's cost into **setup** and **walk** (Finding A-1) | two timers | which of the two remedies applies — finer stride, or an incremental setup that builds one cluster's tables at a time |
| **A2** | the prefix-determinism property test (§4d.2) | one test, using the testkit's existing `countingBudget` | whether the invariant six sites believe in actually holds. Prerequisite for relaxing it anywhere |
| **A3** | name the invariant and list its sites (§4d.1) | one doc entry | makes Law I checkable |
| **A4** | *after A2*: relax it at the multi-start pool only, and measure elite-512 against first-come-512 | small | whether the property is costing search quality or only machinery |

A0 is the one that matters. Every allocation question the time lens is designing
around — how much for the enumeration, how much for depth, when to stop — is a
composition problem whose inputs are performance profiles, and we have the
proved, monotone, already-computed quality axis and have never drawn the curve.
