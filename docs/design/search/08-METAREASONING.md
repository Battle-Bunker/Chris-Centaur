# 08 — The metalevel: choosing which computation to run

SEARCH-THEORY lens, document 8. `voc.ts` decides *what the next refinement slice
computes* — catch up a stale cloud, narrow one, advance a held unit, or deepen a
branch. That is a search problem in its own right (the **metalevel** decision
problem), it has a literature with sharp results, and no lens has claimed it: the
TIME lens owns the *budget* and explicitly hands the *lever menu* on, the BELIEF
lens owns what a lever changes, and neither owns the choice.

The headline is a structural observation rather than a defect:

> **The same myopia appears twice in this architecture, at two levels, and both
> times the code has independently invented the same patch. Nobody has named
> either as an instance of the other.**

---

## 1. What `voc.ts` does, precisely

Per slice, `VocOrchestrator.next(view, policy)`:

1. `estimates(view, gate, leverage)` emits a `LeverEstimate {lever, value, cost,
   family}` for each *(held unit, applicable lever)* pair, gated to units whose
   meeting time is within the next ring or which the ledger cites;
2. the posture policy may strike out whole families
   (`spend === "depth-and-gradient"` keeps only repairs);
3. a **depth preview** rule fires while nothing is advanced (repairs only, so the
   first multiplicative spend happens after the horizon is known);
4. otherwise `alternate(pool, lastFamily)` picks, which is
   `argmaxPerCost` — **argmax of `value / cost`** — with a forced family switch
   when the same family won last time;
5. deepen is never chosen by a value/cost comparison at all; it is **rationed by
   stability** and restricted to the two branches that define the decision (the
   leader and the highest-`hi` un-refuted rival), because *"the two currencies do
   not exchange"*.

Point 5 is the strongest idea in the file and I want to say so before criticising
anything: refusing to invent an exchange rate between *slack at a fixed horizon*
and *horizon itself* — `Confidence` is a pair, `compareConfidence` is a partial
order that returns "incomparable" — is exactly right, and it is the same refusal
the bounds layer makes about cross-basis comparison. Two refusals, one principle.

## 2. The literature, and the name for what points 1–4 are

Russell & Wefald (*Do the Right Thing*, 1991; *Principles of Metareasoning*,
AIJ 1991) formalised choosing computations by their **value of computation**
(VOC): a computation is worth running when its expected effect on the *object*
decision exceeds its cost. Their tractable approximation is the **single-step
assumption** — also called *meta-greedy* — which estimates each computation's
value *as if it were the last one to be run*.

`argmaxPerCost` is the meta-greedy policy, exactly.

And meta-greedy has one famous failure, stated in the same literature that
introduced it:

> **Computations whose value only appears in SEQUENCE are systematically
> undervalued.** A single computation that changes nothing, but which makes a
> second computation decisive, scores zero and is never selected.

Hay, Russell, Tolpin & Shimony (*Selecting Computations: Theory and
Applications*, UAI 2012) give the modern treatment: the metalevel problem is an
MDP; the myopic policy is its one-step greedy approximation; and the useful
middle is the **blinkered** approximation — value a *sequence* of computations
that are all directed at the **same object** (in their setting, one action; in
ours, one unit or one branch), which is tractable and provably better than
myopic while far cheaper than the full metalevel MDP.

## 3. Finding M-1: `alternate()` is `pairRepair()` for the metalevel

This is the observation this document exists for.

| level | the greedy step | where it gets stuck | the hand-built escape |
|---|---|---|---|
| **object** | `sweep` — try one unit's deviation, accept on improvement, as if it were the last move | two units must move **together**: neither single move improves, the pair does | `pairRepair` (2-opt on resolver-named pairs), `jointPolish` (≤3-block), `perturb` |
| **meta** | `argmaxPerCost` — value one computation as if it were the last | a **sequence** of computations only pays off together: catch up a stale cloud, *then* narrow it, *then* deepen past it | `alternate()` — force a family switch when the same family won last time, accepting anything within `bestRatio / 2` |

Both are one-step-greedy searches. Both have the same failure mode for the same
reason. Both have a hand-built diversification patch bolted on. Neither patch is
named as an instance of the other, and neither is the literature's principled
version:

- at the object level, the principled version of "two units must move together"
  is **k-opt / ejection chains** (doc 03 §4), whose cost is linear in the
  coordination size where a block is exponential;
- at the meta level, the principled version of "a sequence pays off together" is
  the **blinkered** valuation — price the *bundle* of computations directed at
  one unit, at its bundled cost.

> **Finding M-1.** The architecture has independently discovered the same
> theoretical problem twice, at two levels, and patched it twice with the same
> shape of workaround (forced diversification). Recognising them as one problem
> gives one design lever instead of two accidents — and in both cases the
> literature's remedy is *value the bundle*, not *alternate between families*.

## 4. Finding M-2: the blinkered member is one summation away

`estimates()` already emits, for the **same held unit** `h`, up to three levers:

```ts
if (h.staleness > 0)                      out.push({ lever: catchup(h),  value: …, cost: h.staleness + 1 })
if (h.rung === "free" && a.citeLo > 0)    out.push({ lever: narrow(h),   value: …, cost: 2 })
if (a.citeLo > 0 || a.citeHi > 0)         out.push({ lever: advance(h),  value: …, cost: 3 * … })
```

They are priced **separately** and compete **separately**, which is exactly the
meta-greedy framing. But they are also a **ladder on one object**: a stale unit
must be caught up before it can be narrowed (the code says so — *"stale units
cannot be narrowed or advanced (lever preconditions)"*), and a narrowed unit is
what makes a later deepen non-vacuous (the deadline law: *"never deepen past a
FREE gated unit's meeting time — narrow it first, or the new leaves arrive
vacuous"*).

So the dependency structure the blinkered approximation needs is **already
encoded, as preconditions**. The blinkered member is:

> for each held unit, in addition to the individual levers, emit the **bundle**
> `catchup → narrow` (and `catchup → narrow → advance`) as a single estimate
> whose value is the bundle's terminal value and whose cost is the sum. Let
> `argmaxPerCost` range over individuals *and* bundles.

That is a handful of lines, it changes no lever semantics, and it directly
targets the failure mode `alternate()` is patching. If it works, `alternate()`
can go — which is a *deletion*, and this program has learned to prefer those.

Two honest caveats:

1. **The bundle's terminal value is not the sum of the individual values.**
   Catch-up's value formula prices its own citations; the bundle's value is the
   value of the *narrow* it enables. So the bundle estimate needs a value, not
   a sum of values — but that is exactly one existing formula evaluated under
   the assumption that the precondition has been met, which is a cheap
   substitution rather than a new model.
2. **This makes the metalevel decision depend on more state**, and the metalevel
   is inside the prefix-determinism perimeter (doc 07 §4a). The bundle is a pure
   function of the same `LeverView`, so it does not read a clock and the property
   survives — but it should be checked against A2's property test rather than
   assumed.

## 5. Finding M-3: the largest concentration of unprovenanced constants in the search

Ruling 49 requires every fitted value to carry its fit provenance. `estimates()`
contains, in about fifty lines:

| where | the numbers |
|---|---|
| catch-up | `+ 0.5` base value, `1 + branchesCiting` leverage multiplier, `1 + 0.5 × staleness`, cost `staleness + 1` |
| narrow | `1 − min(1, 4 / max(4, cloudSize))`, `0.5 + satRatio`, `+ 0.01`, cost `2` |
| advance | `0.7 × citeLo`, `1.2 × citeHi`, `stillCited = 0.5`, cost `3 × (advancedCount + 1) × max(1, horizon) × (1 + 2 × remainingDepth)` |
| stability | `slack ≤ max(epsilon, 0.2 × slackScale)`, and the vacuous-scale guard `|deadBelow| / 2` |
| alternation | the acceptance band `bestRatio / 2` |

That is **fourteen** numbers, none carrying provenance, all governing *which
computation runs next* — which means they govern how every other measured
quantity in the system was produced. The file's own header attributes the design
to a port (*"Ported from bot-orchestration policy D with its real-engine
correction"*) and cites two measurements (*"VOC reaches horizon 2 by ~150 work
and regret 0.0 by 1200; without it one seed cost 1000 regret until ~2600 work"*),
which is more than most modules have — but those measure the **lever order**, not
the fourteen coefficients.

> **Finding M-3.** The lever *order* is measured and defended; the lever
> *pricing* is fourteen unprovenanced constants. And the pricing is upstream of
> every other measurement the program takes, because it decides what got computed
> before anything was compared. Under Ruling 49 these are members with a
> provenance of "policy D, ported", and that provenance should be written on
> them.

The cheap mitigation is not to re-fit them — that is a research project and
probably a distortionary one. It is to **make the metalevel's choices
observable**: `this.log.push(lever)` already records every lever chosen, and
nothing reports the distribution. One row per decision — levers by family, and
how often `alternate()` overrode `argmaxPerCost` — tells you whether the fourteen
constants are doing anything or whether one family wins everything and thirteen
of them are inert. That is the same question the `proposedBy` instrument asks one
level down (doc 03, Finding P-7), and it should be built the same way.

## 6. Finding M-4: the metalevel has no performance profile either

Doc 07 §3's point applies here with extra force. VOC prices a lever by a
hand-written `value` and a hand-written `cost`, and the object-level quantity it
is trying to move — `maxGap`, the proved recognizable quality — is *right there*
and never consulted as an outcome.

The instrument writes itself and needs no new machinery:

> **After each lever is applied, record `(family, cost, Δ maxGap)`.** Over a
> replay corpus that is the *measured* value-per-cost of each lever family, on
> each board class, against the fourteen *assumed* ones.

That is a direct falsification test for `estimates()`, it costs one subtraction
per slice, and it is the only way I can see to hold the metalevel to Ruling 49's
standard without a re-fitting programme. If the measured ratios rank the families
in the same order as the formulas do, the constants are vindicated where it
matters (the ordering) and their exact values stop mattering. If they do not, the
program has been choosing its computations by a fourteen-parameter model that
disagrees with its own outcomes.

## 7. What today's code is, as a member of a VOC joint

```ts
interface Metalevel {
  /** How a computation's value is estimated. Members:
   *  meta-greedy / single-step (today), blinkered (bundles on one object),
   *  measured (Δ maxGap per family, from the profile). */
  readonly valuation: Valuation
  /** How ties and repetition are handled. Members: family alternation
   *  (today), none, bundle-aware (which should make alternation unnecessary). */
  readonly diversification: Diversification
  /** How incommensurable currencies are handled. Members: partial order +
   *  stability ration (today, and it is right), scalarisation (refused). */
  readonly currency: CurrencyPolicy
  /** Which objects are eligible. Members: gated-by-meeting-time-or-citation
   *  (today), all, posture-restricted. */
  readonly eligibility: Eligibility
}
```

| slot | today | verdict |
|---|---|---|
| `valuation` | **meta-greedy**, fourteen unprovenanced constants | the literature's first approximation, with its known failure live and patched |
| `diversification` | **family alternation** with a `bestRatio / 2` band | a hand-built patch for meta-greedy's known failure; the blinkered member should replace it |
| `currency` | **partial order, no exchange rate, deepen rationed by stability** | **excellent, and it is the same refusal the bounds layer makes about cross-basis comparison.** Keep and defend |
| `eligibility` | meeting-time-or-citation gate, posture-struck families | well-argued and cheap; the gate is the metalevel's own version of the entanglement gate the bank uses, which is a pleasing consistency |

Same shape as the BACKUP joint's table (doc 04 §7): one slot excellent, one at
the literature's first approximation, one a patch for that approximation's known
failure, one fine. That recurrence is itself informative — **the parts of this
architecture that refuse to invent a number are consistently its strongest, and
the parts that invent fourteen are consistently where the literature's named
failure modes are live.**

## 8. Cross-lens

### C-T9 — the metalevel is the TIME lens's lever menu, and its *pricing* is unclaimed

Their design absorbs the lever menu into the hypothesis market
(*"unifying ponder targeting, speculative contexts, thread seeding, ruling-41
focus narrowing, and the future D2 socket, whose output plugs in as market
weights"*). That is the right home for **which hypothesis** gets a tranche. But
the market needs *bids*, and today's bids are `value / cost` from fourteen
constants. **Ask: does the market price its own bids, or does it consume prices
computed elsewhere?** If the latter, `estimates()` survives the refactor intact
and unmeasured, which is the outcome the composition lens's finding 4 warns
about for exactly this class of number.

And doc 07's ask compounds here: a market whose bidders are anytime components
needs **profiles**; the metalevel is the place a profile would be consumed.

### C-B6 — the metalevel's levers are the BELIEF lens's removal operations

Their reducibility joint is *"one provenance enum on the hold record, read by the
lever menu and nothing else"*, distinguishing held-by-choice (compute can remove
it) from held-by-ignorance (only observation or deduction can). That is precisely
`eligibility` in the table above, and it is a member of this joint rather than a
separate mechanism. Their correction — that the tag governs *removal* levers and
must not foreclose *hedged preparation*, which is priced by the scheduler — is a
statement that `eligibility` and `valuation` are different slots. Agreed, and the
table above keeps them separate for exactly that reason.

### C-V5 — the fourteen constants are a VALUE-lens-shaped problem in a SEARCH-lens location

The value lens's method is: find the common currency, derive the coefficients
that were being guessed, and let one fitted constant remain. `estimates()`'s
values are denominated in *citations* (`citeLo`, `citeHi`) multiplied by
hand-chosen weights, and citations are already a proxy for "how much this unit
moves the bound" — which is a **weight-unit** quantity the bounds layer can
report exactly. **Ask: is `Δ bound width per unit` a derivable substitute for the
citation-times-coefficient product?** If it is, most of the fourteen dissolve the
same way `room: 3` did, and the answer is measurable by Finding M-4's instrument.

## 9. Build order

| # | increment | cost | what it decides |
|---|---|---|---|
| **M0** | report the lever log's distribution per decision — levers by family, and how often `alternate()` overrode `argmaxPerCost` (Finding M-3) | one row; `this.log` already exists | whether the fourteen constants do anything, or one family wins everything and thirteen are inert. Same question as `proposedBy`, one level up |
| **M1** | record `(family, cost, Δ maxGap)` after each applied lever (Finding M-4) | one subtraction per slice, on top of doc 07's A0 | the *measured* value-per-cost of each family against the fourteen assumed ones. A direct falsification test for `estimates()`, and the only Ruling-49-compatible way to hold the metalevel to account without a re-fitting programme |
| **M2** | the **blinkered** member: emit `catchup → narrow` bundles as single estimates at summed cost (Finding M-2) | a handful of lines | whether the principled remedy beats `alternate()`. If it does, `alternate()` is deleted |
| **M3** | write the provenance on the constants: "policy D, ported, real-engine correction; the *order* is measured, the *coefficients* are not" | a comment block | Ruling 49 compliance, and it stops the next reader from treating them as validated |

M0 and M1 are both one line of instrumentation on state that already exists, and
between them they answer whether the layer that decides *what gets computed* is
steering by a model that agrees with its own outcomes. Given that this layer is
upstream of every other measurement the program takes, I would put M1 alongside
S0 and S0¾ in the top tier.
