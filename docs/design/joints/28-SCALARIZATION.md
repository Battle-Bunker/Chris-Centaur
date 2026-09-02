# The combination law is a choice with a theorem attached

Cycle 12. Librarian domains 23–24: weighted-sum scalarization provably cannot
reach Pareto points off the convex hull, at **any** weight vector — and this
lens types the VALUE kind's law as a weighted monoid, which is a weighted sum.
Three consequences to adjudicate, one regime distinction they did not name that
decides when the theorem bites, and one cost their "nearly drop-in" understates.

---

## 1. When the theorem bites — the regime fork, which has to come first

The reachability result is about **multi-objective** scalarization: several
objectives, a Pareto front, and a scalar collapse that can only ever land on its
convex hull. Whether it applies here depends on something the VALUE programme is
actively trying to change:

| regime | what the fold is | does the theorem bite? |
|---|---|---|
| **incommensurable preferences** — terms are stated in their own units and a weight vector expresses taste (`material: 10`, `room: 3`, chosen not fitted) | a **scalarization of several objectives** | **yes, exactly** |
| **one currency** — every term is a flow in weight-share units, and coefficients are *fitted to predict one measured objective* | a **regression onto a single objective** | **no** — there is no front; misspecification shows up as a bad fit, and the remedy is non-linear terms (which is the Möbius/scoped work), not a different scalarization |

**We are in the first regime today and aiming at the second.** The scoring
audit settled that the shipped weights are declared, not fitted: *"10:1
material:positional was a CHOSEN design rule (feature may never outbid a unit's
life), never fitted"*. So today the fold really is a scalarization of taste, and
the theorem applies to it in full.

That reframes the item usefully in both directions: **the reachability theorem
is an argument for the currency programme** (finish it and the constraint
dissolves), **and a warning about the interim** (until it is finished, there are
Pareto-optimal plans no weight vector can select).

## 2. My chief refusal applies to my own law slot — and I unwind a narrowing

`00 §5`'s refusal is *"no joint with one member — a collection of one is a
constant wearing a socket's clothes"*. The librarian turns it on the combination
law, and it lands: **the scalarization family is a collection with known
members**, and I had pinned it to one.

Worse, I pinned it *after* arguing the other way. `02 §7.2` narrowed my original
"the composition law is a member param" to "additive over the currency, with one
derived band", on the VALUE lens's argument that once everything is a
commensurable flow, addition is the law. That argument is sound **in the second
regime and only there**. In the regime we are actually in, addition is not *the*
law; it is *a* law with a known and specific blind spot.

> **VALUE's law, final form.** The kind's law is **a declared scalarization**,
> with the family as its member collection:
>
> | member | reaches | notes |
> |---|---|---|
> | `scalar/weighted-sum@1` | the convex hull only | today's fold; **launch default**, because it is what ships and byte-identity depends on it |
> | `scalar/chebyshev@1` | **the complete front, convex or not** | weighted max against a reference point; §4 for the free `z*` and the real cost |
> | `scalar/eps-constraint@1` | the complete front | optimise one term subject to bounds on the others — and note the bank already *has* bounds machinery |
> | `scalar/lexicographic@1` | a different subset again | today's comparator, in its honest form |
>
> A bot binds one. The binding is in `botDiff`, and a measurement pooled across
> two scalarizations is refused rather than averaged — they do not select the
> same plans, so they are not two settings of one thing.

**Budget note** (`27 §5`): this costs the visible layer **nothing**. It
parameterises an existing law row with a member collection; it adds no
coordinate, no kind, no `Choice` form and no named law. Members are cheap by
design; dimensions are not.

## 3. The lexicographic → additive migration: derivability, not expressiveness

Adopted verbatim, because it corrects a claim of mine. `02 §7`/`07`'s B7
increment describes moving the twelve-slot comparator to "additive over the
currency plus a named residual precedence". The right justification is
**derivability and legibility** — coefficients that can be fitted and audited,
instead of a precedence vector nobody can vary — and **not** expressiveness:
lexicographic is a *different scalarization with different reachability*, so the
migration trades one blind spot for another.

And it explains, cleanly, why the γ-interpolation claim had to be withdrawn:

> **No continuous parameter connects two scalarizations that select different
> Pareto subsets.** A dial can move *within* a member (γ inside the currency, ε
> inside the reduction's contamination class); it cannot move *between*
> members. That is the general form of the withdrawal, and it retro-justifies
> the instinct in my first cycle — the law is a member choice — while keeping
> the VALUE lens's correction that *within* a member the freedom is small.

Three positions, reconciled: the law slot has members (choose one, no dial
across them); each member has continuous params (dials within); and the
narrowing that said "addition is the law" is true only in the one-currency
regime we have not reached.

## 4. Chebyshev: the reference point is free, and the cost is not where they said

**The free part, confirmed.** Augmented Tchebycheff needs a reference point
`z*` that dominates every attainable point. The bank already computes a per-plan
**ceiling** per objective, so the componentwise max of those ceilings is an
upper bound on what any plan can attain — an ideal point, for free, from
machinery that ships.

**And the catch that comes with it:** `z*` is a *value*, so under Law P it is
**premise-indexed** — it depends on the frame, the horizon and the admitted set.
A `z*` computed under one frame and reused under another silently distorts every
comparison that reads it, and unlike a weight it does so *non-uniformly* (it
moves the max, so it changes which term is binding for which plan). So `z*` is
carried with its premise like anything else, and it is recomputed when the frame
changes.

**The cost their "nearly drop-in" understates.** It is drop-in *mathematically*
and not *computationally*: a sum is decomposable across features and a max is
not. The evaluator is 45–64% of a decision's self time and its fold is
incremental and memoized per feature; a weighted-max collapse breaks that
decomposition, because changing one feature's contribution can change which term
attains the max. Interval arithmetic survives fine (`[max lo, max hi]`), and the
law harness's monotonicity survives (max is monotone), so the damage is
localised to incrementality — which is precisely where the performance is. So:
**seat it as a member and measure it against the sum on equal wall clock**, and
expect the comparison to be about search volume, not only about which plans are
reachable.

**One boundary, so two collapses are not confused.** The scalarization lives
*inside* VALUE — how contributions combine into one plan's value. The REDUCTION
site-class table governs how values become an order over plans, and
`emission/collapse` (`26 §1`) governs how that order becomes one move. Three
collapses, three homes; conflating them is how a "weighting" question turns into
an unnamed decision somewhere else.

## 5. The sixth inert-weight cause: non-convexity

`23 §3` lists five causes of a weight that does nothing. This is a sixth, and it
is the only one whose remedy is *change the law rather than the number*:

| cause | signature | remedy |
|---|---|---|
| (a) per-unit admission | option absent from the priced set | ordering / cap |
| (b) no gradient | term constant across compared plans | re-denominate per plan |
| (c) sparsity | support rare (8.17% of unit-decisions) | reach, or stop measuring it there |
| (d) joint-level admission | plan never enters the enumeration, or loses to the incumbent | ration / seeding / incumbency |
| (e) emission refusal | priced, then refused by the rate limiter (15–43%) | ECONOMY-obligation |
| **(f) non-convexity** | **real spread at comparison, option in the priced set, response not monotone-then-worse — but the argmax JUMPS between two plans as `w` crosses a threshold and never rests on intermediates** | **a different scalarization** — no weight reaches the skipped plans |

The signature is checkable in sweep data we already hold: sweep a weight finely
and look for a **jump discontinuity in the selected plan with no intermediate
plateau**. A monotone-then-worse response is a normal optimum; a clean jump is
the convex-hull boundary showing itself. That test costs a re-mine, not a batch.

## 6. Net changes

| # | change | affects | budget |
|---|---|---|---|
| 1 | VALUE's law is a **declared scalarization** with a four-member family; weighted-sum is the launch default; measurements are not pooled across members | `07 §2`, `02 §7.2` (narrowing unwound) | none — parameterises an existing row |
| 2 | the additive migration is justified by **derivability and legibility**, not expressiveness; **no dial connects scalarizations** (dials live inside a member) | `07` B7, `02 §7.2` | none |
| 3 | `z*` from the bank's ceilings, **premise-indexed and recomputed on frame change**; Chebyshev's real cost is loss of fold incrementality | `28 §4` | none |
| 4 | **cause (f) non-convexity**, with a jump-discontinuity signature testable on existing sweep data | `23 §3`, `07` finding 6 | none |

Their three recorded limits are honoured: this does not touch the currency work
(separable — and §1 says the currency work is what would retire the theorem),
it does not predict that our fronts are non-convex (that is what §5's test is
for), and it does not default to Chebyshev. **The point is that it is a choice,
so it is declared, measured, and diffable like every other choice here.**
