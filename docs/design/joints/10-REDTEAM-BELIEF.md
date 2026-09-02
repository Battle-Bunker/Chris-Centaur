# Red team: the EPISTEMICS carve, under composition pressure

Adversarial pass on `design/belief-fog` (`04-SYNTHESIS.md`, read with 00 and 02
so as not to strawman). Assignment: attack the falsifiable claim
(*"if building invisibility potions requires touching bounds, bank, risk,
search, scout, postures or belief.ts, this factorization was wrong"*), attack
the observer-indexed belief's cost model, and find the coupling the carve hides.

**Verdict up front.** The object is right and I have adopted it. The
falsifiable claim is **not falsifiable as scoped** — its exempt list excludes
the modules its own amendments hit — and, more seriously, it measures the wrong
thing: invisibility's danger is not a diff, it is a **regime shift** that leaves
every listed module untouched while making its exceptional branch the normal
one. Five findings, severity-ordered, each verified against source at `3090b77`.

---

## F1 (headline) — "Touches nothing" is measured in diffs; the damage is a regime shift, and it lands on the least-validated channel in the system

`postures.ts` classifies FOGGED-VACUOUS when *"the gated claims are saturated
and the residue is undischargeable"*, where `residueDischargeable` is defined as
*"is at least one cited unit refinable (**not stale-unrefinable**, not already
at the bottom rung)"*. Under invisibility a hidden unit is **permanently
stale-unrefinable**: nothing we buy makes it fresh.

So on a fogged board with saturated claims, the governor lands in
FOGGED-VACUOUS — and that state's own documented semantics are: *"the floor
becomes a VETO ONLY; ordering transfers to the est/gradient channel plus the
sticky-staged incumbent."*

The claim is therefore **true about the code and false about the consequence**.
Zero lines change in `postures.ts`, and the bot's ordering authority moves, as a
steady state on every fogged board, from the proved floor to `est` — the exact
channel this lens's own `02` doc shows is currently **precision-laundered**, and
whose terms are `fitted: false` across the board. The governor was designed for
holds that are *temporarily* stale because a scheduler chose not to spend; it
now classifies a *permanent* condition into a branch built for an occasional
degradation.

**This is the coupling the carve hides**: the reducibility tag correctly
separates *what removes width*, and correctly says the epistemic state is
identical — but the *consequence* of an identical state differs when it is
permanent, because every downstream mechanism that was tuned as a
"degrade-gracefully" path becomes the operating point. Sameness of state does
not imply sameness of regime.

**Sharpened claim I would defend instead** (falsifiable, and it bites):

> Building invisibility changes no soundness law and no bound arithmetic. It
> WILL change: which posture is modal, which lever the economy can offer, and
> how many frozen slots exist. Each of those three is a named, measured,
> pre-registered number, and the acceptance test is that each moves *within a
> predicted band* — not that no file is touched.

---

## F2 — The economy does not merely need "filtering"; `voc.ts`'s lever preconditions are inverted for game-held units, and a permanently stale unit is a permanent claim on compute

`voc.ts` (lever generation):

```
if (h.staleness > 0) {
  out.push({ lever: { kind: "catchup", unit: h.unitId },
             value: (a.citeLo + a.citeHi + 0.5) * mult * (1 + 0.5 * h.staleness),
             cost: h.staleness + 1, family: "repair" })
  continue // stale units cannot be narrowed or advanced (lever preconditions)
}
```

Three consequences under invisibility, none of which is a filter:

1. **The only lever offered for a stale unit is `catchup`** — and `catchup` for
   a game-held unit is the one operation that cannot succeed. `narrow` and
   `advance`, the two levers that *are* still meaningful, are excluded **by
   precondition**, not by economics. Step 6's "reducibility tag filtering the
   lever menu" is therefore an **inversion** of the precondition structure, not
   a filter over it.
2. **The value/cost ratio does not vanish, it converges.** Value grows as
   `(cites + 0.5)·(1 + 0.5·s)`, cost as `s + 1`, so as staleness → ∞ the ratio
   tends to `0.5·(cites + 0.5)` — a *constant, non-vanishing* claim on the
   budget, forever, for a repair that can never be performed. And the fallback
   selector picks the **maximum-staleness** stale unit for catch-up
   (`voc.ts` ~708), so the permanently-hidden unit is preferentially chosen.
3. The two-currency law ("no scalar") is unaffected — this is not an argument
   against the tag; it is an argument that the tag's *consumer* needs surgery
   the plan prices as a config filter.

## F3 — `MAX_FROZEN` is a shared scarce resource with two producers, and the overflow remedy is structurally unavailable under fog

`substrate.ts` throws `TooManyHeldError` above `MAX_FROZEN` (32), and the error
text names the remedy: *"Model more units (name them in the plan), or split the
decision."* Modelling a unit means **naming where it goes** — which is exactly
what a game-hidden unit forbids.

So under invisibility:

- every hidden enemy is a **mandatory** hold, competing for the same 32 slots as
  the scheduler's **optional** holds;
- the documented remedy is unavailable for the mandatory ones, so the scheduler
  must give way — the compute economy's freedom shrinks precisely when fog is
  worst;
- the kit's own config validator already refuses shapes whose worst-held exceeds
  `MAX_FROZEN_CAPACITY = 32` on the grounds that *"decisions would silently stop
  modelling their farthest opponents"* — a rule written for held-by-choice that
  will now bind on held-by-ignorance, i.e. on the game's own configuration
  rather than on ours.

Nothing in the carve says who arbitrates the slots. That is an **allocation
policy** (ECONOMY, in the composition carve) that only exists once fog does, and
it is not in the build sequence. Minimum ask: name the arbiter, and make the
overflow a *narrowing* (drop the farthest hidden unit to a coarser, board-wide
claim) rather than a throw — because a throw here is a lost turn, and this
program has already lost turns to an exception in a bounds path.

## F4 — The reducibility tag is not a partition: deduction is compute that removes observation-tagged width

The tag's three values (compute-meet / observation / nothing-this-turn) are
presented as the removal-operation classification. But the plan also defers C2
(sub-step non-event exclusion) as *"a purchasable narrowing behind the
reducibility tag"* — and C0/C1/C2 are **deductions**, which cost compute and
remove width the tag calls `observation`.

So the tag conflates *currency* with *availability*: observation-tagged width is
partly compute-reducible after all, via deduction rather than simulation. Since
the lever menu is filtered **by the tag**, a consumer reading it as written will
refuse to buy the C-rungs on exactly the units they were built for.

Fix (small, and it strengthens the tag): the tag names **the set of operations
that can remove this component, each with its own price** — `{simulate: µs,
deduce: µs, wait: unbuyable, never}` — rather than a three-valued enum. A
partition over *currencies* is what the economy needs; a partition over
*epistemic causes* is what the tag currently gives, and the two are not the same
partition.

## F5 — The canonical weight tracks OUR ignorance, so fear rises with fog at fixed ε

Cover-counting derives `w(r) ∝ |C(r)|` from the support itself. Under fog the
support is larger (more admissible enemy actions, more hidden-position
coordinates), so the cover counts flatten toward uniform, and
`E_w[V] → (uniform average) → ` close to the worst case the blend was meant to
soften. The ε-contamination reading `(1−ε)·E_w + ε·lo` then becomes *more
pessimistic as fog deepens*, at unchanged ε.

Two consequences worth pre-registering:

- The "fear is expressed exactly once" property holds **formally** (one dial)
  and fails **behaviourally** (effective risk aversion is a function of mask
  size). If a human operator's paranoia dial silently means something different
  on a fogged board, that is the Centaur surface lying quietly.
- It is cheaply measurable before anything ships: **entropy of `w` versus mask
  size** on seeded boards. If entropy rises steeply with mask size, ε needs a
  fog-normalisation term, or the operator surface needs to display the effective
  ε rather than the set one.

## F6 — The reappearance oracle is anti-correlated with the risk it audits, and it throws in production

Three defects, in increasing order of seriousness:

1. **Sampling bias.** The oracle can only fire on *reappearances*, so it audits
   short holds (small clouds — the easy regime) and is silent about a unit that
   stays hidden for thirty turns (huge clouds — the regime where dilation
   soundness is actually at risk). The audit's coverage is inversely
   proportional to the danger.
2. **Attribution.** A violation is indistinguishable between a dilation defect
   and a premise defect — and this lens's own §4.3 says the static
   `CloudPremise` is *already* unsound across real turns. Until the
   time-indexed premise lands, the oracle mostly measures that.
3. **It throws.** A hard throw on the ingestion path of a live game is a lost
   turn, and this program has the exhibit: a `BoundsInversionError` from a ~1e-4
   rounding difference forfeited a turn, and the accepted repair was to *weaken
   both endpoints to the midpoint* rather than throw. The oracle should widen
   (treat the reappearance as evidence the cloud was too tight, widen and
   record) and throw only in tests and replay.

## F7 — `Belief(observer)` is priced as "pure deduction"; its cost is measured in frozen slots and megabytes

The carve puts second-order weights out of scope but keeps an observer-indexed
constructor for pricing concealment. Three cost objections:

1. **It multiplies the one structure that has already caused a memory blocker.**
   The engine feedback ledger records `CloudSource.timelines` as a strong map
   with unbounded sources — *+33 MB retained per 100 turns, three concurrent
   games reaching 415 MB of a 512 MB cap by round 200*. `Belief(observer)`
   instantiates support machinery per observer. The cost model must be stated in
   **slots and MB per observer per turn**, not as "pure deduction".
2. **It contends for `MAX_FROZEN` with F3's two producers**, or it needs its own
   field — which is the same allocation question again, now three-sided.
3. **"Exactly" is true only for the fragment that matters, and the doc claims
   more than it needs.** *Do they see us* is exact when the mask is a public
   function of public state and our own hidden state. *What they believe about a
   third party* is not, because it depends on their vantage on units hidden from
   us too. Scope the constructor to the first fragment explicitly, or the first
   member that wants the second silently reintroduces the regress the carve
   forbids — and the type is the place to say it: **an observer index is a
   premise coordinate with a declared maximum depth of one.**

## F8 — Conditioning depth is an unnamed premise coordinate

`ConditioningTrace` is described as cacheable and kept out of `CloudTimeline` to
keep the latter pure. Good. But **which rungs ran (C0 / C1 / C2) changes `S`**,
hence changes every envelope computed from it — so two branches conditioned to
different depths are values in different fibers, and the projection tag triple
`(horizon, weight-id, basis)` does not carry it.

This is the same defect class as the `frame` coordinate I owed this lens
earlier: a computation-dependent input to the support that is not in the key.
The remedy is identical — conditioning depth joins the tag, and the cache keys
on it — and the reason it matters is the same: it becomes load-bearing exactly
when the thing is *selective*, i.e. as soon as C2 is priced per unit rather than
run everywhere.

---

## What holds, and what I adopt

- **The object holds.** (S, w) with the five laws, the quantifier-vs-measure
  reading of sound-vs-advised, and the projection table are adopted in this
  lens's `01`/`02` and are load-bearing there.
- **The reducibility joint is real and is the deepest thing in their line** —
  F4 sharpens its type, it does not dispute it.
- **`'adversarial'` as the socket's zero point** is the right shape and is what
  lets ruling 13 be a *population* rather than a special case.
- **The ingestion framing** (`S' = condition(dilate(S), obs)`, today's game as
  the degenerate total-mask case) is correct and is why the fog work is
  tractable at all.

The disagreement is narrow and it is about *evidence*, not architecture: a claim
of the form "no file is touched" cannot see a regime shift, a lever precondition,
a slot budget, or an operating point. Replace it with three pre-registered
numbers (modal posture, lever availability, frozen-slot occupancy) and the same
carve becomes falsifiable in the way it was trying to be.
