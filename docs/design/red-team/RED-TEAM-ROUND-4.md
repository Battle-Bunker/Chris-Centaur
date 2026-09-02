# RED TEAM, round 4 — the saddle retirement, the logit kills, scalarization, the weighted DSM, the coming owner object, and F1's changed shape

Docket sources: `design/search-theory` @ a97ce83 (doc 09 + probe),
`design/belief-fog` @ afd3642 (doc 17), `design/joints-composition` @ tip
(docs 13, 28, 29). Code checks run against `claude/cluster-lookahead`
(`matchPin`/`prunedLedger` verified at `search/core.ts:1490-1492`).

---

## 1. The pure-saddle retirement (search 09) — sound at its stated scope, with one tautological board and one missing geometry the scope quietly excludes

**What closes, plainly.** The instrument is right: `pureDuality = minMax −
maxMin` is exact, solver-free, and a true upper bound on `vMixed − vPure`
(verified against the probe: `restricted-gap.probe.ts:421-483`). The
non-vacuity defence (span and row-min spread of 4–9 weight units against a
gap of exactly zero) rules out the constant-matrix objection. Finding 3.3
(five boards produce no columns, correctly, because nothing contacts) is a
genuine result about where the question can even be posed. The corrected S0
spec — exact test first, solver only when `pureDuality > 0` — is strictly
better and cheaper than the doc-06 version. And the population premise is
stamped on the output, which is exactly what ruling 49 requires.

**Their three self-corrections (§4) — verified, with one graded.**

- **(a) rowSupport → pureDuality: the right correction.** Support size
  measures tie-degeneracy, not mixture value — many optimal rows make every
  mixture over them optimal without any being *better*. The replacement
  discriminator is exact and one pass. Correct, and the cycle-4 claim it
  retracts was indeed wrong.
- **(b) µs → ms: honest, and the corrected budget arithmetic (2 ms at the
  200 iterations the residual needs) still supports the conclusion.** Fine.
- **(c) floor-saturation "one contrary signal": half right.** Declaring the
  prediction untested (deadFrac = 0 everywhere, so the saturation mechanism
  never fired) is correct and important. But the "contrary signal" is
  overclaimed: on `contested-3` the floor discriminating *more* than the
  midpoint is an off-regime observation — the prediction is about
  DEAD-saturated floors, and with zero DEAD cells nothing in this data bears
  on it in either direction. It is untested with *no* signal, which is a
  cleaner and slightly humbler statement than the one recorded.

**Two limits their §6 does not contain, and the second is the one that
matters.**

1. **`hub-queen` is a structural zero.** With `cols = 1`, `maxMin` and
   `minMax` are the same maximum over one column — a 1-column matrix cannot
   have a duality gap for any payoffs whatsoever. One of the four
   column-producing boards is therefore tautological, and the informative
   evidence base is three boards (contested-3, contested-queen, corridor),
   not four. The table should mark it.
2. **The scope excludes the exact geometry that motivates mixing, and their
   own §4(c) names the missing board without connecting it.** `deadFrac = 0%`
   on every board means no cell in any matrix carries a lethal punishment.
   The textbook case for mixed play in simultaneous games is the
   mutual-threat guessing game — matching-pennies structure, where each pure
   choice is fatally punished if predicted: the head-to-head cell, the
   slider-dodge. That structure requires DEAD-grade cells in the matrix, and
   the board set never produces one. Meanwhile the column generator itself
   works against finding cyclic structure: columns are B1/B3 minimisers —
   replies chosen because they are bad for *many rows at once* — which is
   the opposite of the row-specific punishment pattern a gap is made of, and
   the entanglement gate (their limit 5) admits enemies precisely where
   claims meet staged paths, not where guessing games live. So the
   retirement's evidence base is three non-lethal matrices priced through a
   reply generator biased toward saddle-compatible columns.

   **The demand is one board, already specced by their own §4(c):** the
   mutual-kill board (both heads onto one cell, equal weight, no escape) and
   a slider-dodge board, run through the same probe. `pureDuality = 0` there
   too and the retirement is airtight on hand-built evidence and I will say
   so; `pureDuality > 0` localises exactly where mixing lives, which their
   S3 (contested-vs-quiet adjudication split on real play) then prices by
   frequency. Either way the same board settles §2.3's saturation prediction
   — two open questions, one board, and the retirement should not be quoted
   as final until it runs.

**Consistency note in the retirement's favour.** §5's table is careful in
precisely the place round 3 demanded: C-T1 is *dissolved* only for the mixed
member, and set-valued arity "stands alone" on its non-game-theoretic
argument (maximality's set shrinks as belief sharpens; Γ-maximin's singleton
does not). That makes round 3's emission-collapse site-class row *more*
urgent, not less — the set-valued reduction is now the sole survivor of the
direction, and it still lacks its named collapse member at the barrier.

---

## 2. The logit kills (belief 17) — the pre-registration is exemplary; the corpus premise bounds the harness's authority more tightly than the doc says

**Concede first, loudly.** P1–P4 committed before the run; P2 (the
librarian's constructive claim) refuted cleanly — monotone worsening across
the whole β grid, no interior minimum; P3 passed *as registered against the
librarian's throwaway*; the scoped caveat ("refutes logit-with-food-V, not
the family") declared before the numbers and honoured after. The slate
consequence correction (§"corrected": the collapse is NOT earned; the family
stays as the family of record with β̂ = 0 ≡ an already-refuted member) is
exactly the discipline rounds 1–3 kept demanding. This is the
best-conducted measurement cycle any lens has produced.

**The docket's question, answered: on a near-deterministic corpus, log-loss
supplier comparison can rank V-alignments and refute (V, family) pairs — it
cannot crown a supplier, and "uniform wins" is a statement about our Vs, not
about opponents.** Walk the mechanism. Our bots are deterministic mod seed:
each corpus action is a delta function of (state, seed), and the only
smearing comes from state-pooling in the supplier's featurisation and from
seed-driven tie-breaks. Against a delta, any directional model pays
unboundedly for pointing wrong, while uniform-over-support pays a flat
log|support|. So the observed line — uniform beats every directional weight
tried, at every β — is the *signature of misspecified V against a
deterministic policy*: hypothesis (ii) in their own reading, which the doc
states but leaves co-equal with (i). It deserves to be primary, because it
has a direct, cheap test the doc misses:

> **Demand (constructive): the mirror supplier.** The corpus's true
> generating process is *our own bot*. Run `decide()` at low budget on the
> opponent's seat and use its argmax (softened by the seed-lottery's actual
> distribution) as a supplier. We own the policy, so this is computable
> offline. Its log-loss against the ~1.0–2.2 uniform baselines measures the
> headroom no tried supplier has touched: mirror ≈ 0 confirms the
> deterministic-population hypothesis outright and reclassifies every
> supplier comparison on this corpus as "which cheap approximation of our
> own policy is best" — with the ruling-49 rider that none of it transfers
> to humans or foreign lineages, since the population coordinate of every
> one of these fits is our own lineage. Mirror substantially above zero
> would instead vindicate state-pooling as a real information limit and
> restore some authority to the family comparisons.

Until the mirror runs, the harness's authority on this corpus is: (a) rank
candidate value functions by β̂(V) — their V-alignment meter, which is a
genuinely good instrument and the right constructive residue; (b) refute
specific (V, family) pairs; (c) nothing about production defaults beyond
this lineage. The doc's own FitProvenance discipline already implies (c);
it should be said in the slate-consequence paragraph, because
"uniform-over-support remains the reference and default-on-pieces the only
admissible non-uniform supplier" reads like a production verdict and is a
corpus-bounded one.

---

## 3. Scalarization (composition 28) — the fork holds; the launch default is consistent; one member is mistyped

**The regime fork holds, and it is the document's best move.** Taste-weights
scalarizing several objectives (today: `material: 10` chosen, not fitted) is
inside the theorem; fitted coefficients regressing onto one measured
objective (the currency programme's target) has no front to miss. The fork
correctly turns the theorem into an argument *for* the currency work plus a
warning about the interim, and the three-collapses-three-homes boundary
(scalarization inside VALUE; ordering at REDUCTION; one move at
emission/collapse) is exactly the discipline round 3 demanded for the
barrier. One caveat to pin so regime 2 is not oversold: even with one
currency, the *distribution* of share (risk) can re-open a second axis —
which is fine, because that axis lives declared in REDUCTION's (supplier, ε)
— but the fork's "no front in regime 2" is true only because the risk
functional is a separate declared choice. The doc implies this; one sentence
would close it.

**Weighted-sum as launch default is consistent with the warning** — the
default is what ships, byte-identity gates depend on it, measurements are
not pooled across scalarizations, and cause (f)'s jump-discontinuity
signature is testable on sweeps already on disk. One sequencing demand: run
the (f) re-mine *before* B6's lexicographic→additive migration is treated
as behaviour-preserving-then-improving, because the migration lands the bot
squarely in the regime the theorem bites (declared taste weights, weighted
sum), and a cheap re-mine either clears it or names the plans the new law
cannot select. Their §5 builds the test; it should be gated into B6's
falsifier row.

**The mistyped member: `scalar/eps-constraint@1` is a closure wearing a
VALUE law's clothes.** ε-constraint optimises one term *subject to bounds on
the others* — plans violating the bounds are not down-weighted, they are
**removed from the feasible set**. Under this lens's own order-not-set law
(knob taxonomy, 02 §3), anything that removes options is a set-closure and
both closures are kernel-side; a VALUE-law member that closes sets breaks
the kind discipline the manifest exists to enforce. Two honest fixes: type
it as ordering (`infeasible ⇒ ordered-last`, never removed — Chebyshev-like
reach with a soft penalty), or seat the constraint half at the closure joint
with the declared-restriction machinery and leave only the objective half in
VALUE. The table should not ship with the member as written.

**Chebyshev's costs: conceded.** The premise-indexed `z*` (non-uniform
distortion when stale — sharper than the generic staleness point) and the
incrementality loss (max breaks per-feature memoisation, and the evaluator
is 45–64% of self time) are both right, and "measure against the sum at
equal wall clock" is the correct experiment shape.

---

## 4. The weighted DSM (composition 29) — the verdict survives the weighting; the weighting itself needs its sensitivity stated

**What the audit finds: the conclusion is robust, the headline number is
prior-sensitive, and the doc conflates their statuses.** Weight-1-per-commit
(a pair in a 2-file commit earns w = 1; in a 15-file commit, w ≈ 0.0095) is
one point on a family: `w = 1/C(n,2)^α`, with cycle 12 the α = 0 endpoint
and cycle 13 the α = 1 endpoint. The two conclusions have different
sensitivity to α:

- **The distribute verdict survives every α > 0**, because it rests on
  *positive evidence of non-cohesion*: `A:order`'s files are among the
  busiest in the tree (weighted touch 5.01) and their internal pairs occur
  *only* inside large commits. That asymmetry — active everywhere, never
  moving together in small commits — is qualitative and does not depend on
  the exact discount. The honest-zero discipline (counting possible pairs
  before reading a 0% self-share, refusing to judge `A:sample` and
  `A:closure`) is exemplary and conceded in full.
- **The MODEL reversal (30% → 6%) is exactly the finding most exposed to
  the α choice**, because it is driven by the commits the weighting
  penalises hardest. The qualitative identification (bulk fix-rounds over
  `partial-engine/`) makes the direction credible, but the magnitude is a
  prior, not a measurement, and the doc reports it with the same confidence
  as the ratio. Report the α-sweep (α ∈ {0, ½, 1} costs three lines) and
  the dropped-sweep classification (4 commits, hand-labelled — researcher
  degrees of freedom) beside the headline, so the next reader can see which
  findings move.

**And one caveat neither cycle states: co-change is endogenous to the
structure being replaced.** 76 commits of history measure the seams of the
*current* factoring — files co-change partly because of where boundaries
sit today — and the Parnas criterion is about *future* likely changes,
which past co-change proxies only under stationarity. This programme is
mid-rearchitecture: maximally non-stationary. The DSM is evidence, and the
convergence with Parnas's forty-year position is real and worth the
citation; it is not a measurement of the domain, and the kind/module field
split should rest (as 29 §3 mostly does) on the argument, with the matrix
as corroboration.

---

## 5. The candidate-set owner — the attack named before the spec lands

29 §2 names the missing abstraction ("the candidate set has no owner;
nothing sees the whole pipeline") and the docket is right that an owner
which *sees everything* is a bus in waiting. The trap is specific, and it
would undo 29's own verdict: the distribute conclusion says ACTION's stages
belong in their consumers' modules — an owner *class* that imports
generate/order/close/factor/sample/admit/emit to *call* them would re-fuse
ACTION into exactly the module the DSM just refused to create, one level
up, with a uses-structure god object where the kind used to be.

> **The line to hold when the spec lands: the owner owns the candidate
> set's STATE and TRACE, never the stages.** Concretely — (a) a typed
> lifecycle record threading the existing pipeline: every candidate carries
> its disposition (`admitted | closed(cause) | capped(granularity) |
> priced | refused-at-emission(reason)`), which is the admission-trace
> coordinate rounds 1–3 kept demanding, landing in its natural home; (b) a
> **conservation law** as the owner's only invariant: dispositions
> partition the generated set — no candidate vanishes without a recorded
> cause — which is the one-line check that would have made the
> three-granularity finding and the 15–43% emission-refusal class
> impossible to miss; (c) stage implementations stay where the DSM put
> them, in their consumers' modules, and the owner's API is append-only
> observation plus end-of-decision assertion — no dispatch, no ordering
> authority, no budget authority. An owner with a `run()` method is the
> bus; an owner that is a ledger with an invariant is the fix.

I will attack the spec against this line when it lands.

---

## 6. F1 re-checked against Option A (composition 13) — the standing item changes shape

Doc 13 changes the facts under my longest-standing finding, and mostly for
the better. **Verified in shipping code: `matchPin` consults the
`prunedLedger` (`search/core.ts:1490-1492`), so a human-pinned sacrifice
already plays end-to-end today** — the fatality closure removes the option
from the bot's own consideration, not from the operator's reach. That
reframes the wall exactly as 13 §2 says: the missing half is not
authorisation but *disclosure*, and the owner's question shrinks from "may
the closure law be premise-indexed" (round 1's demand — a safety-floor
change) to "may the bot compute and surface sacrifices for a human to
authorise" — strictly smaller, and Option A answers it with no law change,
no floor change, full reversibility, and the three-failures-one-square
unification (sacrifice + commit-timing + option-surfacing on one boundary)
which I concede is the right synthesis of my rounds 1–3 items.

**Status change: F1 is RESOLVED-BY-DESIGN for centaur play, pending the
owner's Option A, with one technical gap and one honest residual.**

- **The gap: the warrant member as specced cannot pass its own acceptance
  test.** §3.1 re-prices pruned-fatal options "through the ordinary VALUE
  fold" — a one-ply team-level fold. But wall 3 of the sacrifice problem
  (my round 1, their §2 point 3) recurs *inside* ADVICE: a corridor-seal's
  payoff is future inflow, invisible at one ply at any weighting — that was
  the whole reason the sacrifice never priced. Acceptance test 1 (2-weight
  death seals a corridor worth 30) fails under a one-ply warrant pricer for
  the same reason the search never found the move. The fix is one clause:
  the ADVICE ration buys *deep* pricing for warrant candidates — a thread
  rooted at the sampled pruned-fatal plan, same door, same budget
  discipline — so the warrant carries `plies > 1` provenance like any deep
  finding. Without that clause Option A ships a sacrifice surface that can
  only warrant one-ply captures, i.e. the sacrifices the prune already
  admits.
- **The residual, honestly priced by the doc itself:** unattended play
  (a pure-bot arena arm) still cannot sacrifice under A. 13 §5's framing —
  if the owner's priority is unattended strength, that argues B, "and the
  trade should be stated to him in exactly those words" — is the right way
  to put it, and §7's owner paragraph is faithful to both options. My
  round-1 demand 1 is accordingly rewritten: not "law change, needs the
  owner" but "Option A plus the deep-warrant clause closes centaur play;
  Option B remains the priced, gated path if unattended sacrifice play is
  ever wanted; the owner chooses between them, not between slogans." That
  is what a decision package should do to a red-team finding, and I am
  recording that it did.

---

## 7. The one-index claim (prior-art 29 @ d14283d) — the falsifier, run as asked

The author asked for an attack, and the falsifier is as cheap as advertised.
I expressed each of the eight appearances as widen/narrow/transport against
the documents that define them. **Result: the one-INDEX claim survives; the
one-ALGEBRA claim does not. Three appearances resist, and the first
resistance is the sharpest because the programme has been circling it for
four rounds without this derivation.**

**Resistance 1 — the OBSERVABLE coordinate refuses the widen operation, and
this is my standing cross-horizon item arriving from an independent
direction.** For support, measure, config and range, two values are the
*same quantity* computed under different conditions, and a weakest common
premise exists at which both remain true (wider, lossy, sound) — join works.
For the observable coordinate, `est[(1, f, w)]` and `est[(3, f, w)]` are
**different quantities**: there is no premise at which a one-ply frame value
and a three-ply value become statements about one thing, and the only sound
"join" is the vacuous hull `[DEAD, WIN]` — total, sound, and
information-free. `frame` joins non-trivially (pending-span widening is
exactly a certified join — round-fusion's rule); `horizon` does not. That is
why the depth rung exists as a *licensed comparison member* rather than a
join, and why four rounds of this red team have demanded a written
cross-horizon law: the observable coordinate selects **which fiber bundle**,
not which point in the base, and the algebra's three operations only govern
the base. The one-index table papers over this by writing "tag-erasure"
under widen for the belief tag — erasing the horizon tag is not a widening,
it is the laundering the refusal law exists to prevent.

**Resistance 2 — the basis column has its direction backwards, or the two
lenses mean different things by `Assumption`, and the table inherits the
ambiguity.** The table puts "assumption union" under *widen* and
"discharge" under *narrow*. But if assumptions are validity conditions —
which the bank's cross-basis *refusal* implies (a bound valid only under
its assumption set cannot be compared out of it) — then unioning them makes
the premise *stronger* (narrower, fewer worlds), and discharging one
(proving it away) moves *weaker* — and the costs run opposite to the
support coordinate's: narrowing-by-assuming is free, widening-by-discharge
is priced. If instead assumptions are what-a-join-gave-up records (the
composition lens's 01 §2 reading: "a join must record what it gave up —
that record is exactly `Assumption`"), the column fits the table but then
cross-basis refusal is unmotivated — sound widening records would not block
comparison. Both readings live in the programme's documents today. Either
the table's basis column commits a direction error, or two lenses hold
incompatible semantics for the same word — and either way "one algebra"
fails as stated: what survives is **one partial order with per-coordinate
operation sets and per-coordinate cost orientations**, which is weaker and
should be what M73's law says.

**Resistance 3 — the statistical coordinates (CPP stratum, instance
features, fit corpus) support join only as the useless hull, and the
operation everyone actually performs is a FOURTH operation the algebra
lacks — which the programme has already built.** Coarsening a CPP stratum
as practiced is *re-pooling and re-fitting* — a new estimation at the
coarser premise, which can land outside the hull of the finer strata
(Simpson's), so it is not the join; the sound join (interval hull of the
per-stratum estimates) exists and nobody wants it. And moving a fitted
number *sideways* — consuming it at a sibling premise the fit never covered
— is neither join (unsound), meet (nothing narrows), nor advance (no turn
boundary): it is the **penalized crossing**, and `08-FIT-PROVENANCE`'s
`σ²_transfer` is its implementation. The algebra of the actual programme
has four operations, and the fourth is priced in precision rather than in
compute. Calling stratum-coarsening a "join" invites treating pooled fits
as sound widenings, which is precisely the laundering ruling 49 exists to
forbid.

**What passes, conceded plainly:** the bounds basis and belief tag as
projections of the premise (by construction); the trace key + durability
(a premise id for computations — refine/coarsen/re-derive map cleanly, and
Salsa's durability-tier resolution of the churn objection is genuinely the
composition lens's stable/volatile split with a field mechanism behind it);
feature space and instance features as *keys* (they fiber decisions and
experiments rather than values, a looseness the two-scales split absorbs);
induced width, which the document itself correctly demotes to derived. And
M73's core — **do not build a seventh parallel key; extend the one index**
— survives all three resistances, because every resistance is about the
*operations*, not about whether the coordinates belong on one index. The
convergence evidence (four lenses each finding "the index is missing a
coordinate" without noticing the others had) is real and the strongest
paragraph in the document.

**The C59 earning test — undecidable as stated, decidable with one word
changed.** "Dropping it lets two incomparables compare" presupposes the
judgment in dispute: every proposed coordinate arrives with an argument
that some comparison is unsound without it — that argument is *why it was
proposed* — so the test as stated filters nothing; every coordinate argues
itself in. The document's own three adjudications (range passes, induced
width fails, instance features pass-at-one-scale) were decided by the
author's soundness judgment, not by the test. The decidable form is the
programme's own witness discipline: **a coordinate earns its seat with a
recorded exhibit — a concrete pair of values at one address with different
truths (the four-defect table is four such exhibits), or a theorem naming
the pair (C37's range), or a measured recomputation cost** — recorded on
the coordinate the way `FitProvenance` is recorded on a constant. The
recomputation half of C59 is already decidable (cache-hit rates with and
without the coordinate: measure it); the comparability half needs the
witness. Without this amendment, C59 is taste wearing a test's clothes.

**The two-scales split — a real distinction, and a sprawl home unless it is
typed as a projection.** Per-decision and per-experiment scales genuinely
differ (the premise vs the arm/corpus coordinates; the designs already
maintain both). The danger is the coordinates that live at both scales —
`evalVersion`, budget regime, bot address — which under a two-registry
reading get registered twice and drift, reproducing at the meta level the
exact disease M73 names ("two premises for one value, maintained
separately"). The split is safe under one rule: **every per-experiment
coordinate is either a declared rollup of a per-decision coordinate or a
corpus/population identifier; anything else is refused.** With that rule
the two scales are one index with a projection between them; without it
they are the seventh and eighth parallel keys.

---

## 8. Standing table after round 4

| item | status |
|---|---|
| F1 sacrifice | **RESOLVED-BY-DESIGN (Option A) for centaur play** — pending owner choice; deep-warrant clause owed (§6); unattended-play residual explicit |
| F3b commit timing | **CLOSED as design** — `advice/commit-timing` reads the verified world-readable `moveStatuses` doc; proactive half seated at the human's hand, which the product reserves anyway |
| F11 advice kind | **CLOSED** — Option A is its worked form with launch members |
| pure-saddle retirement | sound at stated scope; **mark hub-queen tautological; run the mutual-kill and dodge boards before quoting as final** (§1) |
| set-valued reduction | round-3 demand *upgraded*: now the sole survivor of its direction; the emission-collapse site row is still unwritten |
| logit/supplier harness | authority bounded to V-ranking and pair-refutation on this lineage; **mirror-supplier run demanded** (§2) |
| scalarization | fork holds; launch default consistent; **`eps-constraint` mistyped — closure in VALUE clothing** (§3); (f)-test gates B6 |
| DSM | distribute verdict robust; **α-sweep and hand-label sensitivity owed beside the headline**; endogeneity caveat recorded (§4) |
| candidate-set owner | attack pre-registered: **ledger-with-invariant yes, controller no** (§5); conservation law = the admission-trace coordinate's home |
| cross-horizon comparison law | **STILL UNWRITTEN — and now independently derived**: the one-index falsifier's first resistance (§7) shows the observable coordinate admits no non-vacuous join, so the depth rung's licence cannot be a lattice operation and must be a named member law. Two independent derivations of one missing law is as loud as this gets |
| one-index claim (prior-art 29) | **index YES, algebra NO-AS-STATED** (§7): three resistances (observable/horizon; basis direction-or-Assumption ambiguity; the penalized crossing as an unacknowledged fourth operation, already built as σ²_transfer). M73 survives as "one index, per-coordinate operation sets, durability tiers". C59 undecidable as stated — witness-based amendment supplied. Two-scales split safe only as a typed projection |

The round's shape: two of my three oldest findings closed by designs that
are better than my demands (13's disclosure reframe; 22+17's scoped
adoption), one measurement cycle (17) sets the standard the others should
be held to, and the largest retirement (09) is sound but quotable one board
too early. The machine is now mostly failing in the ways mature designs
fail — unstated sensitivities and unrun confirmatory cells — which is what
rounds 1 and 2 were trying to buy.
