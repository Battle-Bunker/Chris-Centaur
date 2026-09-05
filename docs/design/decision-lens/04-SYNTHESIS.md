# 04 — SYNTHESIS: the one decision lens

DECISION-LENS, document 4. Inputs: `01-DATA-MODEL.md` (1030), `02-INSPECTION-UI.md`
(845), `03-KERNEL-SURFACE.md` (974), written independently against three
branches, plus `../ONE-ENGINE-PLAN.md`, the concurrent rewrite that replaces the
bot's substrate with a single settlement seam over the vendored engine.

This document is the reconciliation. §1 states what all three lenses found, once
each, in its strongest form. §2 decides the six places they disagree. §3 disposes
of every open question the three raised — 33 of them — as answered, deferred with
a trigger, or measured. §4 is the resulting model in one place. §5 is the union
of the three delete lists. §6 is the seam with the rewrite and the order
constraint between the branches.

Where a lens is right, this document cites it and moves on. Where two are right
about different halves, it says which half. Where one is wrong on evidence the
other supplies, it says so with the evidence.

---

## 0. The thesis, after three lenses

The row is the moveset; the moveset is a whole-board plan seen through a cluster;
the cluster is a connected component of the interaction graph over the units the
bot may still move; and every number on the row was computed by the decision
before the lens asked for it. Three independent designs converged on that, and on
three further things they each thought they were the only one to notice: that a
decomposed aggregate is a lie without a named joint residual, that the ranking an
operator inspects must be the same object a lock stages rather than a second
computation that happens to agree, and that live play and replay are one pure
fold over one event type. Those are Laws A, B and C below, and everything in §4
is machinery for keeping them true.

The lens is therefore not an instrument bolted to the search. It is the search's
own discarded work, retained: `better()` already computes the ranking and drops
the loser (`search/core.ts:410`), the kernel already searches the speculative pin
context one slice in four and collapses it to a scalar (`pins.ts::adviseFromReport`),
and the emission already carries the whole-board bracket the table wants. The
cost claim that survives all three reviews is **the lens adds no evaluation to
the hot loop** (03 §0); §2.4 and §3 are what it takes to keep that claim honest
under an operator who is clicking.

---

## 1. What the three lenses agree on

Six laws. Each was found independently by at least two of the three, and each is
stated here in the strongest formulation any of them reached.

### Law A — the joint law, with the residual named

> Every number a moveset carries is the **whole-board proved bracket of a
> complete plan**, with the units outside the cluster fixed at a named
> complement. There is no cluster-local value and no per-unit value. A per-member
> column is a **contrastive delta against a fixed reference action**, stored
> beside a **named joint residual** equal to `aggregate − Σ deltas`, and no
> consumer — UI, miner, or a later aggregation — may reconstruct the aggregate by
> summing the deltas. A display that shows the deltas without the residual is
> showing a total that does not add up and hiding the fact.

01 Law C1 + Law C2 (§2.3, §3.3); 02 §3.7 *"the joint row is mandatory whenever it
is non-zero"* and demand D-b; 03 §2.3 + §2.5. All three cite the same measurement
— `evaluate/index.ts`'s opening note that summed per-unit values fail to cover
joint value **in both directions**, and `search/02-DECOMPOSITION.md` §2's *"the
error is the difference between a unit living and dying"*.

The strongest formulation is 02's, because it is the one that binds the display:
a zero residual is itself a finding and must be rendered as `+0.00 [why?]`, not
omitted. Omitting a zero residual and omitting a large one are the same rendering
bug, and only the rule "always draw the row" catches both.

### Law B — inspection and action are one object

> The conditional ranking displayed for candidate `u@m` **is** the speculative
> pin context for `u@m`, not a second computation that agrees with it. Its head
> is `conform(ctx ⊕ pin, wirePlan)` — what would actually be staged — never
> `improve`'s best-so-far. A lock **promotes that same cache entry** into the
> committed namespace, so the staged moveset is the inspected moveset because it
> is the same object, not because two rankings coincided.

01 Law C3 + §4.3 (*"the conditional ranking is the tentative-pin speculative
context, exposed"*); 02 §1.4 (*"the moveset drawn on the board when you press
`Space` is the moveset that is staged"* — and its observation that the failure of
this sentence is *"a lie of a particularly bad kind: it is the number the
operator uses to decide whether to lock"*); 03 §3.2 + **[CHANGE 2]**, which
supplies the mechanism the other two assumed: `pinContextKey([...pins], true)`
and `pinContextKey(pins)` are different keys by construction, so today the
operator's hover is searched for four slices and then thrown away on commit.

03's formulation is strongest because it is the only one that is falsifiable at
the code: 01 and 02 both say the two must agree; 03 says they must be the same
cache entry, and names the promotion that makes it so.

### Law C — one reducer, two sources

> Live and replay are the **same pure fold** `applyEvent(store, e)` over the same
> `TurnEvent` type. There is no replay-specific state, no replay-specific shape,
> and no `if (live)` in any renderer. The only differences are who hands the
> events over, whether `at.isHead` is true, and a `provenance` badge — which is
> **content** the operator is entitled to, rendered as a badge and never as a
> branch.

01 Law C4; 02 §2.4 (*"stronger than 'both call the same render function' — it is
the same state machine over the same event type"*); 03 §5.1. The corollary all
three derive independently: every frame must be **whole, not a delta against
something the consumer had to have seen** (03 §5.1), which is why `partition`
carries the entire partition and `movesets` carries the entire reservoir, with
diffs travelling alongside for animation only.

### Law D — retention, not recomputation, on the hot path

> Everything the lens shows about a decision was computed by that decision. The
> retention costs `O(k)` comparisons per priced trial and **zero evaluations**.
> Explanation runs after the final emission (the telemetry pass) or on the
> operator's own click, charged to a reserve carved out **before**
> `searchDeadline` so its cost is visible before the turn starts.

03 §0 and §2.5 own this; 01 §3.3 reaches the same tiering ("eager level 1 for the
staged moveset, lazy everything else") from the storage side; 02 assumes it in
D-c's grading. The reserve is the reconciliation of 01 O5 and 03 §7.5 and is
decided in §3 below.

### Law E — the fiber law: generation, basis, complement

> Two rows are comparable only if they agree on all three of **cluster
> generation**, **`BasisKey`**, and **`complementKey`**. Rows that disagree on any
> of the three are never sorted into one table, differenced, or merged. A
> widening *supersedes* a cluster; it does not merge into it.

01 Law C5 (generation + basis, grounded on `compareFloors`'s
`{comparable:false, refusal:'basis_mismatch'}` at `bounds/score.ts:345`); 02 §1.6
(the widen banner is that refusal, rendered); 03 §2.3 supplies the third
coordinate — `complementKey` — which neither of the others had, and which is the
one that bites in the quiet case: when *another* cluster improves, a retained row
stays **sound** (it was a real bracket of a real plan) while its **question**
changes. 01 and 02 would both have compared those rows.

The generation field, the basis key and the complement key are the same refusal
made visible *before* the comparison is attempted rather than after.

### Law F — fixity excludes, and the direction is one-way

> A unit the bot cannot move this turn is **not a cluster member**. It is drawn,
> it is named in the basis, and it is listed in the cluster's `boundedBy` strip
> with its reason. Because components are monotone in the vertex set, **a lock
> can only narrow or split a cluster and an unlock can only widen or merge one**.
> There is no other direction and no case to reconcile.

01 §2.2 (from the owner's *"operator-pinned moves are excluded from unit clusters
because those decisions are immutable to the bot"*, which is `search/core.ts`
invariant 3); 02 Rule E (*"if the panel shows a unit as a member, the bot is
still choosing its move, full stop"*); 03 T1, which supplies the proof and the
consequence — the UI animates a one-way street and never reconciles a
contradiction. All three also independently keep the same awkward case:
`pin-unreachable`, the committed pin naming a cell the grammar cannot reach
(`kernel.ts:479-497`), where the operator believes they have fixed a unit and
have not. It is a member, it is searched, and its row says so.

---

## 2. The six disagreements, decided

### 2.1 Cluster definition — take 03's graph, **without** the hub fiat

**The split.** 01 §2.1 defines a cluster as a connected component of
`influenceOf(u) ∩ influenceOf(v) ≠ ∅` over commandable-and-unfixed units,
**augmented with every commandable slider (the hub fiat)**, citing
`search/02-DECOMPOSITION.md` §1's measurement that the fiat rescues the
`n=6-with-slider` stratum from 16.1% to 96.5%. 03 §1.2 takes the plain component
and refuses the fiat outright (T2: *"it makes every cluster the whole board, and
the operator's 'the pieces near my queen' becomes 'all of them'"*).

**Decision: the plain connected component of the occupancy-reach graph over
`freeSet`, no fiat.** The fiat exists to make a *decomposed search* sound — it is
a generation device under Law D1, buying exactness for an enumeration that
composes cluster-local results — and the lens never composes anything, because
Law A forbids it. Where a slider genuinely couples two groups its ray is already
an occupancy-reach set spanning both, so the geometry has the coupling; what the
fiat adds over the geometry is precisely coupling the geometry says is not there,
which on a display is a lie shaped like caution.

Consequence for 01: `Cluster.hub` is deleted. Consequence for the measurement:
the ≤3-on-98.9% figure is a property of the plain component (`02-DECOMPOSITION.md`
§1 measures both), so 03's T3 continuity story stands unmodified.

### 2.2 Cluster identity — take 03's name+hash+lineage; delete 01's joined key

**The split.** 01 §1 makes `ClusterKey` a **Name** whose form is the member
`UnitKey`s sorted and `+`-joined. 03 §1.5 makes `ClusterId` the **anchor** (the
smallest member id — a name that survives a non-anchor member arriving or
leaving) plus a separate content `key` (members + basis — a hash, for validating
a retained row) plus `lineage`. 02 demand D-a asks for exactly 03's shape and
says why the other one fails.

**Decision: 03's.** A key that is the member list is not a name, it is a hash
wearing a name's clothes: under it every membership change is a *replacement*,
which makes 02 §1.6's widen banner ("α gained a member") unrepresentable and
makes every cursor re-resolution a miss. Law I from `joints/18-IDENTITY-AND-TRACES.md`
§3 — *names find, hashes validate* — is decisive and 01 quotes it on the page
where it breaks it.

The anchor is unstable under merge and under a split that removes it; `lineage`
is what makes those two transitions legible, and the four `ClusterEvent` kinds
(`split | merge | narrowed | widened`) are **derived by diffing successive
partitions, never asserted** (03 §1.5).

**One further reconciliation, unremarked by all three.** 01 keys everything on
`UnitKey`, the wire snake id, citing `pins.ts:23-31` (*"a substrate numbers units
per BOARD — the two must never be conflated"*). 03's kernel types are all
`UnitId`, the substrate number. Both are right in their own layer. **The `lens`
sink translates at the kernel boundary**, which is the one translation point
`pins.ts` already owns: `LensEvent` as emitted carries `UnitId`; `TurnEvent` as
stored, wired and displayed carries `UnitKey`. A stored record carrying a
substrate number is a stored record that cannot be read one turn later.

### 2.3 k and retention — k=5 everywhere, two caps at two layers, and 01's source is dead

**The split.** Both set `k = 5` (01 §4.2 by an attention argument, 03 §2.2 by a
memory argument), so k is not in dispute. What is in dispute is **where the rows
come from** and **which cap bounds them**. 01 §3.1 says the table already exists
as `run.lastView.candidates` and *"the first implementation step of this lens is
to put `lastView` on `KernelReport`"*. 03 §6.3 proves that field is
**structurally always null in production**: `makeSearchCore` returns no
`refinementView`, so `asRefiner(input.search)` yields null, `run.refiner` is null,
`run.lastView` is always null, `KernelReport.levers` is always `[]`,
`EmitRecord.horizon` is always `1`, and `voc.ts` already says so out loud.

**Decision: 03's reservoir is the source; 01's `lastView` ask is refused on
evidence.** The rows are written where `better()` already compares — inside
`sweep` / `pairRepair` / `jointPolish` / `repairSelfHarm` — into a `k=5`
insertion-ordered reservoir per `(clusterId, complementKey)`, ordered on the same
`(lo, est, hi, tie)` key `better()` uses, so the reservoir's order and the
search's order cannot drift.

The two caps are at two layers and compose rather than compete: **24 rows per
decision** is 03's in-memory bound on what the kernel holds; **the frame-keeping
rule** is 01 §6.3's storage bound on what Postgres keeps — top-k for (a) every
emission that changed the staged plan and (b) the last emission of every basis,
with every other emission keeping its header and no rows. Neither replaces the
other and both are `LENS_*` constants in the bot manifest, so changing either
changes `botId` and every stored row says which value produced it.

### 2.4 `minimalPinSet` — refused; lock pins every differing member

**The split.** 02 §1.4 asks the kernel for `P* = minimalPinSet(C, K)`, the
smallest pin set making moveset `K` the conditional argmax, and offers as a
fallback `P* = {u} ∪ {v : K(v) ≠ incumbent(v)}` displayed as `pins ≤ n`. 03 offers
no such query and answers 02's Q2 only implicitly, through `rankConditional`.

**Decision: refuse `minimalPinSet`; promote 02's own fallback to the
definition, and drop the `≤`.** Minimality is a search over subsets of `C` —
`2^|C|` conditional contexts, each at least one slice at ≤18 ms a price — to save
at most `|C|−1` pins on a cluster that is a singleton 88.7% of the time and ≤3
units 98.9% of the time; the arithmetic is 03 §3.1's refusal of option (c) in
miniature. Worse, a minimal set is minimal only against the *current* complement,
so its minimality expires the moment another cluster improves — a pin set whose
smallness has a shelf life is more dangerous than an honest larger one, because
the operator will have read the count and believed it.

And the fallback is not an upper bound: pinning every member whose assignment
differs from the staged plan is **exactly** the set that makes `conform(ctx ⊕ P*,
wirePlan)` stage `K`, because conform splices pins and repairs legality without
searching (`contracts.ts` SearchCore guarantees), and the non-differing members
are already at `K`'s assignment. So the affordance reads `pins 3 of 4` — exact,
computed client-side from the frame, with no kernel query and no `≤`. When
`K` is rank 1 the set is `{u}`, which is 02's common case and today's `Space`.

02's surrounding machinery all survives and is now cheaper: the pre-press count,
the one-shot confirm above `|P*| > 1`, the ownership guard and its three offers,
the atomic fatal-consent gate, and — the important one — the **divergence check**
(record `expected = K`, compare against the next emission's incumbent for
`C ∖ P*`, raise a banner naming which members differ and why). That check is what
makes Law B falsifiable rather than aspirational, and it costs one comparison per
emission.

### 2.5 Observations vs computations — store the frames; 01's rule is refined, not overruled

**The split.** 01 §5.4 rules *"an observation is stored; a computation is
re-derived"* and stores `DecisionInput` so the tables can be rebuilt. 03 §5.3
rules *"store the frames; make re-run the audit"*, on three grounds: bit-exact
re-run is achievable only under the node clock and production runs the wall
clock, so a production replay that re-ran would show the operator a decision that
never happened; the archive predates the build; and re-run parity is a property
to test, not a strategy to serve.

**Decision: store the frames — and 01's rule survives, sharpened.** A `LensEvent`
is not a computation, it is **an observation of a computation that happened, at a
time, on the kernel's clock**; storing it is storing what occurred, which is
exactly what 01's rule protects. What 01's rule forbids is storing a number
*nobody produced during the decision* — a lazily-computed marginal, a conditional
ranking for a candidate no operator hovered — and that prohibition stands
untouched. The two rules meet cleanly at the line: **served ⇒ stored; unserved ⇒
re-derived on demand, badged `rerun`.**

Two consequences. 01 §4.4's "stored eagerly: the conditional ranking for each
unit's staged candidate" is **deleted** — it is a computation the decision never
made, `|ours|` extra conforms bought to make a replay path a read, and with
frames stored the moments an operator actually looked at are already reads.
`DecisionInput` is **kept anyway** (01 §8.2), unchanged: it is small, every field
is already computed and thrown away, and it is the seed for both the CI audit
(§2.6) and the lazy re-derivations.

### 2.6 The replay re-run gate — CI only; `matchesRecorded` is a badge, never a refusal

**The split.** 01 §8.3 makes the re-run a **serving** gate: re-derive the staged
moveset, compare with the stored one, and on a mismatch under the same
`behaviourId` *refuse to serve derived numbers* — "better a hole than a plausible
wrong table". 03 §5.4 makes it a **CI** gate: G1 (frame reproducibility — run a
fixture, serialise every `LensEvent`, re-run, byte-compare) and G2 (prefix
determinism — a `2b`-work run's frame sequence extends the `b` run's byte for
byte), both under `local-game.ts --nodes`.

**Decision: 03's, and 01's runtime refusal is deleted.** Under the production
wall clock the slice count for identical work varied 18 → 92 across two seeds at
the same 150 ms budget (`local-game.ts`, `DEFAULT_NODE_BUDGET` derivation), so a
same-`behaviourId` mismatch is the *expected* outcome of an honest re-run and
01's rule would blank the panel on healthy data — a refusal that fires on
correctness is worse than no refusal. The badge is the part worth keeping: every
derived row renders `observed` or `re-derived by build X` with both ids, which is
`Provenanced.provenance` as content (Law C), and 01's own early-cutoff hierarchy
used for what it is for.

G2 additionally carries a sequencing obligation that nothing else in the design
would catch: it is the only instrument that would see **[CHANGE 1]** (making
`better()` return a reason) accidentally reorder the hottest function in the
search, so G2 lands **before** CHANGE 1 and never alongside it (03 §7.4). The
build order encodes that.

### 2.7 `command_turn_states` — deleted; the checkpoint 02 needs is `turn_boards`

**The split.** 01 §6.2 deletes it: it is *"a denormalised snapshot beside an event
log of the same facts. Two representations of one state disagree; that is not a
risk, it is a schedule."* 02 §2.4 keeps it, demoted from a display source to
**the fold checkpoint** that lets replay seek to a turn without folding the game,
and notes it is cheap and already written.

**Decision: delete it; 02's requirement is met by 01's `turn_boards`.** The
checkpoint a fold needs is the **t₀ anchor of the fold**, and every turn's fold
begins at `board.arrival` and ends at the deadline — a turn's fold never crosses
a turn boundary, so there is nothing to seek *past* and no game-length fold to
avoid. `turn_boards(game_id, turn, settlement, …)` is that anchor, is the re-run
input, and is stored once per turn rather than once per unit per turn.
`command_turn_states` is a copy of the live broadcast shape, i.e. a copy of the
fold's *output*, and keeping an output beside the inputs that generate it is
exactly the disagreement 01 names.

**The general rule this settles**, because it recurs: a stored table that is a
pure fold of stored events is legitimate **iff** a boundary test asserts the fold
reproduces it and a rebuild command exists. Under that rule `movesets` (§4.3)
survives as a *materialised projection* of the `movesets` frames — it exists for
the index `(decision_id, cluster_key, rank)`, not for its content — and
`command_turn_states` does not, because nothing regenerates it.

### 2.8 One more, unlisted: the per-member counterfactual

01 §3.3 prices each member's marginal against **`NO_ORDER_MOVE`**, the reference
action; 03 §2.5 prices it against the member's **next-best candidate**. Take
01's. A fixed baseline makes the column comparable across rows, across members
and across emissions; a next-best baseline is a different counterfactual per
cell, so two numbers in one column answer two questions and the residual stops
meaning anything. 01's `against: { to: CellIndex }` field stays mandatory so a
reader can check which counterfactual was priced, and where the reference action
is not legal for a unit the fallback is its worst-ranked legal candidate, named
in `against`.

---

## 3. Every open question, disposed

33 questions: **26 answered**, **5 measured**, **2 deferred with a trigger**.

### 3.1 From 01 §10

| # | question | disposition |
|---|---|---|
| **O1** | emissions/clusters/projections/events per turn are estimates | **MEASURED.** One instrumented `local-game.ts --nodes` run over both scenarios, counting: emissions per decision, components per turn and their sizes, distinct cluster restrictions priced, `TurnEvent`s per turn. The same run carries 03 §7.3's coverage curve and 03 §7.6's promote counter — **one run settles three questions** and it is the first thing built. |
| **O2** | under fog, does the cluster widen to the cloud's span or show the point-mass partition with a badge? | **ANSWERED: it widens; no badge; `members` stays a list of units.** Law D2′ (`02-DECOMPOSITION.md` §2b′) says occupancy *is* the cloud when position is uncertain — there is no separate fog clause and therefore no badge to draw. The edge relation is over cloud occupancy; at ply 1 with `staleness = 0` that is today's `influenceOf` exactly. The falsifying test (03 §7.7's D-5′ case: a subject whose cloud spans two components while its last-seen cell does not) is **written now and must fail** against point-based reach; it is un-skipped when the substrate exposes cloud reach. |
| **O3** | does a pinned unit leave the cluster or stay as a fixed member? | **ANSWERED: it leaves.** Out of `members`, into `boundedBy` (03's name; 01's `context` is dropped). All three lenses independently reached this (Law F). The coupling an operator might want to see is visible without membership: the pinned unit is in the plan, on the basis, and drawn on the board with its arrow. |
| **O4** | conditional head = `conform` or `improve`'s best-so-far? | **ANSWERED: `conform`.** Law B. `improve`'s best is *better* and *not what would be staged*, which is a lie at the exact moment it is load-bearing. |
| **O5** | speculative share under multiple inspectors | **ANSWERED: a dedicated per-team inspection reserve.** `LENS_INSPECTION_MS` is carved before `searchDeadline`, shared by every inspector on the team, served in selection-recency order with a queue; a request that cannot be served in the reserve gets a **typed refusal**, never silence. Same answer as 03 §7.5's third option, chosen for the same reason: it is the only one whose cost is visible before the turn starts. It also removes `speculativePeriod`'s 25%-per-hover exposure as the funding model. |
| **O6** | who owns `seq`? | **ANSWERED: the active game manager, one writer per `(gameId, turn)`**, asserted by a boundary test (§4.7). The out-of-process case is moot: `decision-worker-pool.ts` is on the rewrite's delete list (ONE-ENGINE §2.5). Trigger to revisit: any decision leaving the process. |
| **O7** | `LENS_TOPK` per cluster or per screen? | **ANSWERED: per cluster in the kernel; per screen is a UI concern that never arises.** The rail shows one cluster at a time (02 §3.7), so the 8-clusters × 5-rows = 40-row case has no display. No cross-cluster greedy selection is built. |
| **O8** | store the restricted payoff matrix (60 KB/turn)? | **DEFERRED.** `PlanScore.witnesses` already supplies the refuter through `DominanceCondition.refuted-by-witness` at ~0 storage. **Trigger:** when the O1 instrumentation shows `refuted-by-witness` null on more than a quarter of the rows an operator actually opened — i.e. the witness channel is empirically empty and the matrix is the only source of a refuter. |
| **O9** | refuse derived numbers across a `behaviourId` change? | **ANSWERED: dissolved by §2.6.** The re-run is not a serving path, so there is no refusal to scope. Every re-derived row is badged with both ids. |
| **O10** | does the source fan out per operator, or the UI hold a per-operator view? | **ANSWERED: one `DecisionSource` per connection, over one shared event store.** `DecisionSource.at` is per-connection state; the fold is pure and the event array is shared, so a per-connection source is a cursor, not a copy. Conditional handles are per-connection and contend for the O5 reserve. |

### 3.2 From 02 §5

| # | question | disposition |
|---|---|---|
| **D-a** | stable `ClusterId` + `derivedFrom` lineage | **ANSWERED: granted**, in 03's shape (§2.2): anchor id (name) + content key (hash) + `lineage` + four derived `ClusterEvent` kinds. |
| **D-b** | decomposed aggregates with a named joint residual | **ANSWERED: granted**, and it is Law A. The joint row is drawn even at zero. |
| **D-c** | graded conditional lists for **every** candidate | **ANSWERED: the grade granted, the "every" refused.** Pricing every candidate is 03 §3.1's option (c): one queen at the measured mean of 64.4 options is 6.4× a whole decision. The rail shows the incumbent's aggregate exact, the hovered candidate's `provisional`, and every other candidate `·` unpriced — never a bare number, which is what D-c's own last clause asked for. |
| **D-d** | persisted event rows byte-shaped like the wire events | **ANSWERED: granted, and stronger.** `turn_events.payload` holds the `TurnEvent` verbatim, so live and replay fold identical bytes; `seq` and `at_work_ms` are columns because they are indexed. |
| **D-e** | persist every emission's top-k and breakdowns, or only some? | **ANSWERED: partition + top-k under the frame-keeping rule (§2.3); breakdowns never stored except the level-1 joint explanation of retained rows written at the telemetry pass.** 02's own lean, with 01's rule supplying the exact predicate and 03's tiering supplying the one eager exception. |
| **Q1** | (restates D-a) | **ANSWERED** with D-a. |
| **Q2** | can the kernel answer `minimalPinSet`? | **ANSWERED: it will not be asked.** §2.4. The count is exact and client-side. |
| **Q3** | do clusters overlap? | **ANSWERED: no.** Connected components of one graph partition the vertex set; a unit is in exactly one cluster. The cloud-spanning case (O2) **merges** components rather than creating an overlap. Consequences: 02's `\` cluster-cycle binding (T5) is deleted, and 01's "if several, the one with the largest aggregate at stake" default is deleted. |
| **Q4** | does focus/hover actually fund compute, and is the A0 echo owed? | **ANSWERED: yes, and yes.** A hover opens (or reuses) the speculative context for that lock (Law B), so the look really does buy search and the operator is owed the echo. The echo is a number the frame already carries: `ConditionalRanking.cursor`, rendered as slices spent, in the rail footer. |
| **Q5** | emission cadence — tens or thousands? | **MEASURED** by the O1 run. The design assumes tens (03 §3.1 estimates ~10 slice boundaries at a 150 ms budget). If the measurement exceeds 100 per turn the lane decimates with a visible "showing 40 of N" and the scrubber snaps to decimated points; that fallback is designed but not built until the number says so. |
| **Q6** | multi-operator lock arbitration: refuse or downgrade? | **ANSWERED: refuse**, with 02's three offers (`[Ask Ben] · [Take over Q] · [Lock rank 1 instead — pins 1]`). Never issue a cross-owner determination without the existing takeover dialog. The idle-ownership timeout is **DEFERRED**; trigger: the first session log showing a lock blocked over 60 s by an operator with no events in that window. |
| **Q7** | draw the refuter? | **ANSWERED: yes, and it is now free.** 03's `DominanceCondition.refuted-by-witness` carries the `Witness` as a by-product of a `better()` branch read backwards, so the dependency 02 was waiting on ("the search lens's refutation retention landing") is discharged by the reservoir itself. `--refuter` hollow arrow on moveset-row hover, per 02 §3.2's reserved token. |
| **Q8** | the 6 s widen auto-accept timer | **MEASURED, with a formula meanwhile.** `min(6 s, 0.25 × (turnExpiryTime − now))`, i.e. the constant becomes a cap on a deadline-scaled value, since `turnExpiryTime` is already on every frame. The measurement that fixes it: the widen-banner-to-accept latency distribution, which is now an event pair on the timeline and costs nothing to collect. |
| **Q9** | should `operator.attention` be off by default in *storage*? | **ANSWERED: on the wire yes, in storage no.** Attention events fund compute (Q4) so they must reach the kernel, but they are numerous, low-grade and mildly invasive; they are dropped at the 30-day fold and are off by default in the timeline lane, with a per-game opt-in. |
| **Q10** | the 380 px rail below 768 px | **DEFERRED.** 02's plan (breakdown demoted to a modal rather than compressed) stands as the design. **Trigger:** the first logged operator session under 768 px on a game with a non-singleton cluster. |

### 3.3 From 03 §7

| # | question | disposition |
|---|---|---|
| **1** | whose complement — may a stale row be read, and is it stored? | **ANSWERED: it may be read and it is stored.** Stale rows are observations (§2.5) and 02 §1.6 already designed their rendering (struck-through aggregates, `stale @ seq n` in the header) — so neither of the two lenses that could have forced the barrier re-price does. The bounded top-3 re-price stays **optional**, gated on `remainingMs > 3 × entry.stepCostMs` exactly as 03 §2.3 specifies, and the row names its complement either way. |
| **2** | does locking *narrow* the cluster, in the operator's vocabulary? | **ANSWERED: yes — "locking narrows" is the word, everywhere.** The header reads `α · 3 of 4 free`; the locked unit moves to the `boundedBy` strip. The alternative reading ("the same cluster with one unit fixed") is deleted from all four documents, because it disagrees about whether the row count can drop to one, and it can. |
| **3** | are `k = 5` and 24 rows right? | **MEASURED.** The coverage curve of `02-DECOMPOSITION.md` Finding D-1: `planDistance(staged, nearest retained row)` per decision, one loop over ≤24 rows, collected on the O1 run. A staged plan at distance 4 from every retained row means the reservoir contributed nothing. |
| **4** | does **[CHANGE 1]** change a decision? | **ANSWERED as a sequencing rule: G2 lands first, and CHANGE 1 is its own commit.** It must not change a decision — the reason is derived from comparisons `better()` already performs in the order it already performs them — but it is a refactor of the hottest function in the search, and G2 is the only instrument that would catch a reordering. |
| **5** | who pays for a live inspection? | **ANSWERED: a dedicated reserve carved before `searchDeadline`** (O5, same answer). The search is unconditionally shorter by a fixed, declared amount; inspection is unconditionally affordable; no exchange rate between compute and attention is ever computed. |
| **6** | how often is a committed pin already in the speculative namespace? | **MEASURED, before [CHANGE 2] is defended.** One counter — `promote` hits vs epoch changes — shipped ahead of the change. If operators mostly commit without hovering, CHANGE 2 is still *correct* (Law B needs it) but its latency value is on a path nobody walks, and it drops out of the critical commit into the follow-on. |
| **7** | fog will make the partition silently wrong | **ANSWERED** with O2: the D-5′ law case is written now with the falsifier built in, and the partition is **never cached across a determination**. |
| **8** | `explainPlan` is optional on `Evaluator` | **ANSWERED: the UI has that state and it is not an error state.** Rows render with bounds and a dominance condition and no feature breakdown; the panel says *"this evaluator does not explain"* rather than drawing zeros. This is 02's D1 lesson — the breakdown derives its rows from the row's own weights table, always, with no engine special case — applied to the empty case, which is the case every non-production evaluator produces. |

---

## 4. The model, in one place

Every type below cites the lens it came from. Sketches only; the build order is §05.

### 4.1 Constants

```ts
const LENS_TOPK          = 5     // 01 §4.2, 03 §2.2 — reservoir width, per (cluster, complement)
const LENS_ROW_CAP       = 24    // 03 §2.2 — in-memory rows per decision
const LENS_INSPECTION_MS = ...   // §3 O5 — reserve carved BEFORE searchDeadline
```
All three are bot-manifest members, so changing one changes `botId` and every
stored row says which value produced it (01 §4.2).

### 4.2 Types

```ts
// ---- identity ------------------------------------------------------- 01 §1, 03 §1.5
type GameId = string; type Turn = number         // BOARD turn. One turn domain. 01 §9.3
type UnitKey = string                            // WIRE id. Stored/wired/displayed.
type UnitId  = number                            // SUBSTRATE id. Kernel-internal only.
type CellIndex = number
type ClusterId = number                          // NAME: the anchor (smallest member). 03 §1.5
type EventId = string                            // `${gameId}:${turn}:${seq}`. 01 §5.2

// ---- cluster ------------------------------- 03 §1.5, + 01 §2.2's reasons, 02 D-a
interface ClusterView {
  readonly id: ClusterId
  readonly key: string                           // HASH: sorted members + basis. Validates.
  readonly generation: number                    // bumps on any membership change. 01 §2.2
  readonly members: ReadonlyArray<UnitKey>       // ascending; the moveset's columns
  readonly boundedBy: ReadonlyArray<{            // drawn, never varied. Law F
    readonly unit: UnitKey; readonly to: CellIndex
    readonly why: 'pin' | 'commit' | 'reference' | 'pin-unreachable'
    readonly by: string | null                   // operator attribution. 02 Rule E
  }>
  readonly lineage: ReadonlyArray<ClusterId>     // 02 D-a; empty at the first partition
  readonly epoch: number; readonly posture: Posture; readonly basis: BasisKey
}
// NO `hub` field: the slider fiat is refused (§2.1).

type ClusterEvent =                              // DERIVED by diffing partitions. 03 §1.5
  | { kind: 'split';    from: ClusterId; to: ReadonlyArray<ClusterId> }
  | { kind: 'merge';    from: ReadonlyArray<ClusterId>; to: ClusterId }
  | { kind: 'narrowed'; id: ClusterId; lost:   ReadonlyArray<UnitKey> }
  | { kind: 'widened';  id: ClusterId; gained: ReadonlyArray<UnitKey> }

// ---- moveset ------------------------- 03 §2.2 spine + 01 §3.1 display fields
interface Moveset {
  readonly cluster: ClusterId; readonly clusterKey: string; readonly generation: number
  readonly key: string                           // planKey of the CLUSTER RESTRICTION
  readonly rank: number                          // 1 = best in this table
  readonly moves: ReadonlyArray<{ unit: UnitKey; to: CellIndex; path: ReadonlyArray<CellIndex> }>

  // THE FIBER (Law E). Three coordinates; all three must match to compare.
  readonly basis: BasisKey                       // 01 §1
  readonly complementKey: string                 // 03 §2.3 — everything OUTSIDE the cluster
  readonly complement: 'live' | 'stale'          // 03 §2.3

  // THE NUMBER. Whole-board bracket of the joint plan. Never a sum. Law A.
  readonly witness: PlanKey                      // 01 §3.1 — Law A's receipt
  readonly lo: number; readonly est: number; readonly hi: number
  readonly channel: 'lo' | 'est'                 // 01 §3.1 — which channel adjudicates
  readonly exact: boolean; readonly ledgerSize: number
  readonly citedUnits: ReadonlyArray<UnitKey>
  readonly assumptions: ReadonlyArray<Assumption>
  readonly vacuity: VacuityCause                 // 01 §3.1
  readonly seenIn: number                        // 01 §3.1 — priced plans with this projection

  // PROVENANCE. 03 §2.2
  readonly rung: 'seed'|'sweep'|'pair'|'polish'|'restart'|'conform'
  readonly at: number                            // kernel clock, ms from t0
  readonly tie: number                           // planTieKey — an indifferent order, reproducibly
  readonly staged: boolean

  // WHY IT IS NOT RANK 1 — the better() branch, read backwards. 03 §2.4 (subsumes 01's Foil)
  readonly dominance: DominanceCondition | null  // null until the barrier
}

type DominanceCondition =                        // 03 §2.4 — the threat/opportunity map, free
  | { kind: 'leader' }
  | { kind: 'refuted-by-witness'; witness: Witness }
  | { kind: 'incomparable-basis'; theirs: ReadonlyArray<Assumption> }
  | { kind: 'contingent';  onUnits: ReadonlyArray<UnitKey>; atStake: number }
  | { kind: 'dominated';   by: number }
  | { kind: 'advisory-only'; estMargin: number } // the row where the bot is guessing
  | { kind: 'indifferent' }

// ---- breakdown -------------------------- 01 §3.3 shape, 03 §2.5 tiering, 02 §3.7 display
interface MovesetBreakdown {
  readonly moveset: string; readonly basis: BasisKey
  readonly aggregate: {                          // LEVEL 1: one explainPlan on the witness plan
    readonly profile: string; readonly bound: Bound
    readonly features: ReadonlyArray<FeatureContribution>
    readonly exact: boolean; readonly ledgerSize: number
  } | null                                       // null ⇒ evaluator does not explain. 03 §7.8
  readonly marginals: ReadonlyArray<{            // LEVEL 2: one explainPlan per member
    readonly unit: UnitKey; readonly delta: Bound
    readonly features: ReadonlyArray<{ key: string; delta: Bound }>
    readonly against: { readonly to: CellIndex } // the FIXED reference action. §2.8
  }>
  readonly residual: {                           // aggregate − Σ marginals. MANDATORY. Law A
    readonly total: Bound
    readonly features: ReadonlyArray<{ key: string; delta: Bound }>
  }
}

// ---- events ------------------------------- 03 §4.3 (kernel) ∪ 01 §5.2 (manager)
interface TurnEvent {                            // ONE type, TWO producers
  readonly id: EventId; readonly gameId: GameId; readonly turn: Turn
  readonly seq: number                           // total order in the turn. The only sort key
  readonly atWall: number                        // UTC ms — humans, cross-turn ordering
  readonly atWorkMs: number | null               // KERNEL clock from t0. Null, never 0. 01 §5.1
  readonly kind: TurnEventKind
  readonly actor: { kind: 'operator'|'bot'|'server'|'wire'
                  ; id: string|null; name: string|null; color: string|null }
  readonly unit: UnitKey | null
  readonly causedBy: EventId | null              // what made this happen
  readonly answers: EventId | null               // the operator event this RESPONDS to. 01 §5.3
  readonly payload: unknown                      // typed per kind
}

type TurnEventKind =
  // produced by the KERNEL, through KernelInput.lens (03 §4.3):
  | 'partition' | 'movesets' | 'emission' | 'operator' | 'posture' | 'conditional' | 'refusal'
  // produced by the GAME MANAGER (01 §5.2), all of which it already computes:
  | 'board.arrived' | 'stage.fastpass' | 'decision.begin' | 'decision.end'
  | 'operator.command' | 'pin' | 'unpin' | 'commit' | 'pin.refused'
  | 'stage.requested' | 'stage.confirmed' | 'stage.retry' | 'commit.observed'
  | 'advice' | 'selection' | 'turn.resolved'
```

**`EmissionFrame` is deleted.** 01 §3.2 defined it as a storage projection of an
emission plus its top-k; with frames stored verbatim (§2.5) it is exactly
`TurnEvent{kind:'emission'}` followed by `TurnEvent{kind:'movesets'}`, and a
second type over the same bytes is a second vocabulary. The renderer's
`LensFrame` (02 §2.3) survives and is something else entirely — the *fold's
output*, not a stored row.

### 4.3 Storage — five tables

```sql
-- 01 §6.1, with §2.5/§2.7 applied. games, server_events, server_liveness,
-- config_store untouched.

turn_boards(game_id, turn, settlement jsonb, board_hash, deadline_ms,
            roster jsonb, created_at)                      PK (game_id, turn)
  -- The re-run input AND the fold's t0 anchor (§2.7). Retained forever.

turn_events(game_id, turn, seq, kind, at_wall, at_work_ms,
            actor_kind, actor_id, actor_name, actor_color,
            unit_key, caused_by, answers, payload jsonb)    PK (game_id, turn, seq)
            INDEX (game_id, turn, kind)
  -- payload is the TurnEvent VERBATIM (02 D-d). One writer per (game,turn) (O6).

decisions(id, game_id, turn, bot_id, behaviour_id, engine, profile,
          basis jsonb, seed, budget_ms, node_budget, assumptions jsonb,
          initial_pins jsonb, modelled jsonb, kernel_options jsonb,
          summary jsonb, started_at, ended_at)              PK id
          UNIQUE (game_id, turn, bot_id)
  -- Carries DecisionInput (01 §8.2) whole: the audit seed and the lazy-path seed.

movesets(decision_id, emission_seq, cluster_id, cluster_key, cluster_gen, rank,
         moveset_key, moves jsonb, witness_plan_key, seen_in,
         lo, est, hi, channel, exact, ledger_size, vacuity,
         complement_key, complement_stale, cited jsonb, basis_key, staged,
         dominance_kind, dominance jsonb)
         PK (decision_id, emission_seq, cluster_id, moveset_key)
         INDEX (decision_id, cluster_id, rank)
  -- A MATERIALISED PROJECTION of the `movesets` frames, existing for its index
  -- only (§2.7). A boundary test asserts the fold reproduces it; a rebuild
  -- command regenerates it from turn_events.

unit_outcomes(game_id, turn, unit_key, unit_name, cluster_id,
              staged_move, staged_source, confirmed_move, committed,
              resolved_move, fatal_consent, operator_id)   PK (game_id, turn, unit_key)
  -- Replaces decision_logs' back-filled move columns without the blob.
```

Retention (01 §6.4): `turn_boards` / `decisions` / `unit_outcomes` forever;
`turn_events` hot 30 days then folded to a per-turn digest (operator commands,
pins, staging outcomes, decision begin/end — dropping refusals, non-staging
emissions and all attention events, §3 Q9); `movesets` hot 30 days then the final
staged frame only. **A folded turn is still inspectable**, because the board and
the basis survive and the re-derivation path is unchanged: retention becomes a
latency decision rather than a loss.

### 4.4 The kernel surface

```ts
// 03 §4.3 [CHANGE 3] — a second sink, synchronous, between slices only, never
// inside one, wrapped in try/catch (a lens consumer that throws must not take a
// decision down). Absent ⇒ the lens costs exactly nothing.
interface KernelInput { /* … */ readonly lens?: (e: LensEvent) => void }

// The query port the running kernel exposes. 01 §11 ask (c) + 03 §3.2.
interface KernelLensPort {
  partition(): ReadonlyArray<ClusterView>
  movesets(cluster: ClusterId): ReadonlyArray<Moveset>
  /** Pure function of (substrate, basis, locks, cursor). Never searches on the
   *  caller's thread; schedules and returns what is known. 03 §3.2/§3.3 */
  rankConditional(cluster: ClusterId, locks: ReadonlyArray<Lock>): ConditionalRanking
  /** Level 1 always; level 2 for the named members. null aggregate ⇒ the
   *  evaluator does not explain (03 §7.8). Charged to the reserve. */
  explainMoveset(key: string, members?: ReadonlyArray<UnitKey>): Promise<MovesetBreakdown>
  readonly reserve: { budgetMs: number; spentMs: number; queued: number }  // O5
}

interface ConditionalRanking {                   // 03 §3.2
  readonly cluster: ClusterId; readonly locks: ReadonlyArray<Lock>
  readonly clusterAfter: ClusterView             // locking NARROWS (§3, 03 Q2)
  readonly rows: ReadonlyArray<Moveset>
  readonly source: 'retained-filter' | 'speculative-context' | 'empty'
  readonly cursor: number                        // slices spent — the confidence channel
  readonly provisional: boolean; readonly degraded: boolean
  readonly contextKey: string                    // pinContextKey([...committed, lock], true)
  readonly final: boolean                        // 01 §7.1 — live is open at the head
}
```

Three kernel changes, all from 03, all still required after reconciliation:

- **[CHANGE 1]** `better()` returns a `Verdict` carrying the refusal branch, so
  the reservoir can store `DominanceCondition`. Gated on G2; its own commit.
- **[CHANGE 2]** on an epoch change, `retarget` promotes a matching speculative
  entry (`spec:[…]`) into the committed namespace (`pin:[…]`), carrying
  `incumbent`, `witnesses`, `cursor`, `citedUnits`, `stepCostMs` — and **not**
  `bounds`/`boundsBasis`, because a floor proved in the old epoch may not gate the
  new one. This is what makes Law B literally true.
- **[CHANGE 3]** the `lens` sink above.

01's ask (a) — put `run.lastView` on `KernelReport` — is **refused** (§2.3): it is
always null. 01's ask (b) — carry an `EventId` on `PendingEvent` and copy it to
the emission's `answers` — is **granted and is the highest-value one-field change
in the design**: the kernel already measures the latency (`ConformanceSample`,
`kernel.ts:501-517`) and already knows the pairing; only the id is missing. It
turns *"the operator pinned and then something was staged"* into *"this write is
the answer to that pin, 18 ms later, 0 slices in between."*

### 4.5 The wire

Five envelopes. Seeking is **not** on the wire: the client holds the whole
current turn's events (kilobytes, bounded by the deadline) and scrubbing is a
local fold (02 §2.4).

| direction | message | payload |
|---|---|---|
| S→C | `lens-frames` | `{ gameId, turn, events: TurnEvent[], head: boolean }` — batched at each emission barrier and each operator event |
| C→S | `lens-conditional` | `{ requestId, cluster, generation, lock: { unit, to } }` |
| S→C | `lens-conditional-rows` | `ConditionalRanking & { requestId }`, streamed: rank 1 first, refinements after |
| C→S | `lens-breakdown` | `{ requestId, moveset, members? }` |
| S→C | `lens-breakdown-rows` | `Provenanced<MovesetBreakdown> & { requestId }` |
| C→S | `lens-lock` | `{ cluster, moveset, pins: [{unit,to}], expected, emissionSeq }` — compiles to one existing `select-move` per pin plus this record, for the log and the divergence check (02 §1.4) |
| C→S | `lens-cancel` | `{ requestId }` |

A refused request returns a **typed refusal** on the same channel (reserve spent,
generation superseded, off-head), never silence — 03's rule, 01's `EmitRefusal`
precedent, 02's requirement that `source: 'empty'` renders as *searching* and not
as *nothing*.

### 4.6 The source and the reducer

```ts
// 02 §2.4 is the primitive: a PURE fold.
type FrameStore = { turn: Turn; anchor: TurnEvent /* board.arrived */; events: TurnEvent[] }
applyEvent(store: FrameStore, e: TurnEvent): FrameStore     // pure
frameAt(store: FrameStore, seq: number): LensFrame          // pure

// 01 §7.1 is the interface over it, adding the two async ports.
interface DecisionSource {
  readonly at: Cursor                            // per CONNECTION (O10)
  seek(to: Cursor): void
  frame(): LensFrame                             // = frameAt(store, at.seq)
  breakdown(moveset: string): Promise<Provenanced<MovesetBreakdown>>
  conditional(req: ConditionalRequest): Promise<ConditionalHandle>
  subscribe(fn: (d: SourceDelta) => void): () => void
}
interface Provenanced<T> {                       // 01 §7.1 — content, not a branch. Law C
  readonly value: T; readonly basis: BasisKey
  readonly provenance:
    | { kind: 'observed'; at: Cursor }
    | { kind: 'rerun'; behaviourId: string; recordedBehaviourId: string }
}
```

`LiveDecisionSource` maps websocket messages to `TurnEvent`s and calls
`applyEvent`; `ReplayDecisionSource` reads `turn_events` and calls **the same**
`applyEvent` **with the same objects**. `breakdown` after a decision ends rebuilds
a substrate from `turn_boards.settlement`, which is the identical code path
replay uses — so *live-after-decision* and *replay* are one path, the strongest
form of Law C (01 §7.2). Under the rewrite this gets easier, not harder: §6.

### 4.7 The UI state machine

02 §1.2–1.3, with two edits from §2 and §3.

```
NONE ──focus(u)──▶ UNIT ──(auto, Law D)──▶ CANDIDATE ⇄ MOVESET ⇄ BREAKDOWN
  ▲                  │                          ▲
  └──blur / Esc──────┴──────────────────────────┘
```

`LensCursor = { unit, candidate, moveset, drill, foil }` — **`cluster` is
removed**, because clusters partition (Q3) and the unit determines its cluster.
Law D (defaults cascade, choices pin) is unchanged: a focused unit is never in a
state where the moveset panel is empty. Transitions T1–T17 stand with:

- **T5 (`\` cycle cluster) deleted** — Q3.
- **T9 `lock`** redefined per §2.4: `P* = {u} ∪ {v ∈ members : K(v) ≠ staged(v)}`,
  count rendered exactly before the press, one-shot confirm above `|P*| > 1`,
  ownership guard with three offers, atomic fatal consent, optimistic apply, and
  the **divergence check on the next emission**.
- Determinations are legal **iff `at.isHead`**; the three modes are
  `live-head | live-scrub | replay` and `live-scrub` is loud (badge, desaturated
  violet ink, every determination affordance replaced by `[N] return to now`).

The reactive policy, unchanged and now shared by all three lenses:
**additive uncertainty is staged; subtractive certainty is applied.** A widen
(unlock, Law F) holds behind a banner with a deadline-scaled timer (Q8), suspended
while the drill panel is open, queued behind an in-flight lock; a narrow (lock,
hold) applies at once with a footer note. On a widen the old table is **never
blanked** — an epoch change is the worst possible moment to take the display away
from an operator deciding whether to lock — it is struck through and superseded
when the new rank 1 lands, ≤1 slice later.

Board vocabulary (02 §3) is adopted whole and unmodified: violet means
hypothetical; only **disagreement draws** (a member whose implied move equals its
staged move gets a ring on the existing arrowhead, not a second arrow); the foil
is `--foil` dotted hollow, only where it differs; the refuter is `--refuter`
(Q7, now buildable); constants keep their current rendering because they are
facts, not hypotheses, and must not be violet.

---

## 5. What it deletes

The union of 01 §9, 02 §4 and 03 §6, reconciled. Items the one-engine rewrite
already deletes are named in §6 and are **removed from this list**, so the lens
branch never contends for them.

### 5.1 Storage and the data path

1. **`decision_logs`, the whole table** — with `move_evaluations` (the per-unit ×
   per-candidate blob whose premise is false), `game_state` per unit per turn,
   `safe_moves`, `position_x/y`, `health`, `bot_recommendation`,
   `submitted_move`, `server_move`, `num_states`. `fatal_consent` survives, on
   `unit_outcomes`. [01 #1]
2. **`turn_states.territory` and `.cell_ownership`** — whole-board Voronoi
   ownership maps per turn. `turn_states.game_state` survives as
   `turn_boards.settlement`. [01 #2]
3. **`command_turn_states`** — §2.7. [01 #4, over 02 §2.4]
4. **The `board turn + 1` decision-log domain** (`telemetry.ts:275-287`). One
   turn domain — board turn — in every table and on every event. [01 #3]
5. **`turn-timeline.ts`'s `SynthesizedTurnRow` merge** — synthesising a board
   from a per-snake decision row, for games logged before `turn_states`. No
   backwards compatibility; delete the merge and keep nothing. [01 #7]
6. **`src/logic/decision-telemetry.ts`** — the pre-lobster anytime compute record
   (`moveSetsPerMove`, `nearbySnakes`, `3^k`). It describes a search this bot no
   longer runs. [01 #8] *(The rewrite lists this file as "unchanged"; it makes no
   edit to it, so the delete is a clean divergence, not a conflict — §6.3.)*

### 5.2 Telemetry and the report

7. **`TelemetryEvaluation` / `DecisionMoveEvaluation` / `LegacyBreakdown` and the
   two-engine dual vocabulary**, including `TelemetryBreakdown.engine: 'lobster'`
   — the discriminator exists to tell a renderer which vocabulary it is reading;
   one engine writes now. With them: `projectedTerritoryCells`, `numStates`
   (**always 0** — a field inherited from the voronoi row shape that has never
   carried a number), and the `weights`/`weighted` mirror plus the
   `[feature: string]: unknown` index signature that made the row untypable and
   so made the triplication unprovable. [01 #5 ∪ 03 §6.1]
8. **`TelemetryEvaluation.score` + `scoreChannel` as the primary column** — a
   scalar whose meaning requires consulting a second field is a value travelling
   without its premise. `bounds: Bound` says it correctly. [03 §6.1]
9. **`TelemetryDecision.contrast`, including `chosenIsArgmax`** — the field exists
   to warn that the per-unit table's premise is false; with the table gone the
   warning has nothing to warn about, and `DominanceCondition` says the true
   thing directly. [01 #9 ∪ 03 §6.1]
10. **The eager explain budget: `MAX_CANDIDATES_PER_UNIT = 6`,
    `MAX_EXPLAINED_CANDIDATES = 96`** — they bound an eager per-candidate explain
    that no longer happens. Replaced by `LENS_TOPK`, `LENS_ROW_CAP` and the
    inspection reserve. [01 #6]
11. **`KernelReport.journal`, `.levers`, `.leverOrderBinding`, `.postureFlips`,
    `.basisHistory`, `.conformance`, `.meanSliceCostMs`** — zero non-test
    consumers between them, and each is a sequence of moments wearing an array's
    clothes. They become `TurnEvent`s with `seq` and causal links; keeping both
    would be two orderings of one sequence. `probes` stays as an internal counter
    and leaves the public shape. **Kept**, explicitly: `contexts`, `speculative`,
    `activeContextKey` (the only inputs to `pins.adviseFromReport`, and after
    CHANGE 2 the surface `rankConditional` reads), `crossfade`, `refusals`,
    `committedUnits`. The `Lever`/`LeverView`/`Refiner` **types** stay — a depth
    rung is a real plan — and the lens ignores them until a producer exists.
    [01 #10 ∪ 03 §6.2, §6.3]
12. **`EmitRecord.slack`'s current derivation.** It degrades today to the
    incumbent's own bound gap, not the root slack the field documents. It becomes
    `max over retained rivals of (rᵢ.hi − leader.lo)` — the quantity the field was
    always documented as carrying, computable for the first time because the
    reservoir is the rival set `rootSlack` never had. [03 §6.3]

### 5.3 The UI

13. **The per-unit heuristic table**: `updateStatsTable`, `updateLobsterStatsTable`,
    the `.decision-stats` markup and `statsTableBody`, and the `averageWeighted`
    cross-candidate averaging inside them. **Keep the lesson**:
    `updateLobsterStatsTable` exists because a hardcoded metric list rendered
    thirty zero rows for an engine with a different vocabulary — the new breakdown
    derives its rows from the row's **own** weights, always, with no engine
    special case. [02 D1]
14. **The Voronoi territory overlay, whole**: `territoryCells` on `TurnData`,
    `boardTerritory` on `board-update`/`snake-turn-update`,
    `wantsTerritoryOverlay` + `set-display-prefs` + `stripUnwantedDisplayData`,
    `territoryOverlayToggle`, `sharedTerritoryMoveState`, `territoryGridForOverlay`,
    `findTerritoryOwnerAtCell`, `moveState.territoryCells`, and per-candidate
    `projectedTerritoryCells`/`projectedCellOwnership`. **Exception kept**: the
    Alt+click cell inspector, reading `logic/territory-view.ts` (which the rewrite
    creates) on demand rather than a shipped-per-turn paint layer. [02 D2 ∧ 01 #2]
15. **The grey `secondaryMove` recommendation hint arrow** and
    `chosenMoveStyle: 'recommendation-only'` — the bot's recommendation is now by
    definition the rank-1 moveset's assignment, drawn as the violet incumbent.
    Two vocabularies for one fact is the collision the ink rule exists to prevent.
    [02 D3]
16. **The whole live/replay fork in `play-game.html`**: `renderHistoricAtTurn`,
    `renderHistoricBoard`, `historicMoveState`, `historicRenderCtx`,
    `showHistoricSelectionPanel`, `showHistoricNoDataPanel`, `switchHistoricSnake`'s
    parallel selection path, `renderPreviewFrame`'s duplicate render, and the
    replay counterpart of `selectMove`. ~900 lines, the highest-value deletion in
    the list: the two paths have already drifted (their empty states differ).
    [02 D4]
17. **`moveEvaluations` as a UI contract** — the per-snake evaluation fan-out and
    `processMoveEvaluations`'s scoring half (`quality`, `getMoveQuality`,
    `getScoreColor`, `candidateTint`, `displayScore`). **Keep its enumeration
    half** — the direction-keyed/destination-keyed split, `candidatesByPosition`,
    `holdCandidate` — which `keynav-machine` depends on and which is correct and
    hard-won. [02 D5]
18. **`safeMoves` as a display concept** — admissibility is now a ledger
    disposition with a grade. **The fatal marker stays**: it is a warning about a
    determination, not a score. [02 D6]
19. **The "waiting for turn data" / "no data" decision-breakdown panels** —
    replaced by the frame's honest emptiness: *"fast-pass only — no kernel
    emission yet at seq 2"*. [02 D7]
20. **`board-test.html`'s hand-built territory fixtures** — they go with #14; its
    `processMoveEvaluations` call survives, since #17 keeps enumeration. [02 D8]

**Not deleted, explicitly**: staged/ghost/committed arrows, the orientation eye,
the hold shield, the fatal marker, goto/near overlays and routes, clash
affordances, unit tags and body plates, death markers, the turn slider, the
roster, the shortcuts pane, `KernelReport.contexts`/`speculative`/`crossfade`/
`refusals`/`committedUnits`, and `staged`/`routes`/`waypoints` in their current
shapes (02 §2.3: rewriting a working dual-source contract to prove a point would
be the junk this exercise is supposed to throw away).

---

## 6. The seam with the one-engine rewrite

`../ONE-ENGINE-PLAN.md` replaces the bot's substrate with a single
settlement-based seam over the vendored engine: `PartialSettlement` becomes the
one type above `substrate.ts`, `substrate.ts` is rewritten 1253 → ~470,
`contracts.ts` is retyped, `src/partial-engine/**` (9,328 lines) and twelve legacy
`src/logic/` modules are deleted. The lens must be built on **that** seam.

### 6.1 Which lens components depend on the new seam

| lens component | depends on | how |
|---|---|---|
| **the cluster partition** (§4.2) | `Substrate.influenceOf` | **Hard.** After §2.1 of the rewrite, `influenceOf` becomes `coverOf(u, board) ∪ pathOf`-cells — a grammar query against the settlement, not a cloud union over slabs. The lens's edge relation is a predicate on that function, so Law F's graph is *defined* by post-rewrite code. Writing it against today's `influenceOf` is writing it against a deleted function. |
| **`MovesetBreakdown` / marginals** (§4.2) | `Evaluator.explainPlan`, `Substrate.withModelled` | **Medium, and the rewrite helps.** `explainPlan` and `FeatureContribution` are untouched (`evaluate/index.ts` is on the rewrite's *unchanged* list). `withModelled` becomes a plain object: the `Proxy`, `CLAIM_QUESTIONS` and `SharedClaimViewError` are deleted because claims are derived per call from the plan's complement, so **a narrower sibling becomes simply correct**. A marginal is exactly a narrower sibling, so the lens's level-2 tier goes from "guarded by a runtime error class" to "trivially legal". |
| **the moveset reservoir** (§2.3) | `search/core.ts` `better()`, `BankResult.bounds` | **Light.** `search/core.ts` is on the rewrite's *unchanged* list, so the write site does not move. But `Moveset.exact/ledgerSize/citedUnits/assumptions` all read off `ScoreBounds`, whose ledger is re-keyed from `SlotMask` bits to `Divergence.heldId` (`bounds/ledger.ts` 117 → ~55) and `EngineScoreBounds` leaves the contract entirely. The fields survive; their producers change. |
| **`turn_boards.settlement`** (§4.3) | `PartialSettlement`, `marshalBoard` | **Hard by definition.** The stored board *is* the settlement input. `logic/turn-oracle.ts` (`marshalBoard`, the one translation) is unchanged by the rewrite, so the marshalling survives; the stored shape must be the post-rewrite one or every re-derivation reads a board the engine no longer accepts. |
| **`ClusterView.boundedBy` reasons** | `kernel.ts` `auditPins` / `searchContext` | **None.** `kernel.ts` (2093) is unchanged by the rewrite. |
| **the `lens` sink, `rankConditional`, CHANGE 1/2/3** | `kernel.ts`, `PinContextCache` | **None.** All in `kernel.ts` and `search/core.ts`, both unchanged. |
| **the UI (§4.7), the event log, the reducer** | nothing in the seam | **None** — but they collide with the rewrite's **files**, not its types: `active-game-manager.ts`, `firebase-interface.ts`, `decision-logger.ts` and `play-game.html`'s territory path are edited by the rewrite's legacy rip. |

### 6.2 The order constraint

> **The lens branch rebases onto `develop` after the rewrite's C5 has landed
> there, and its UI and storage commits land after the rewrite's C7.**

- **C5 (the seam) gates the start of lens *source*.** C5 is the commit that ships
  the new `substrate.ts`, `pathrisk.ts`, `bounds/material.ts`, the retyped
  `contracts.ts`, and deletes `src/partial-engine/**`. Before C5, every lens type
  that names a contract type names one C5 deletes, and the cluster law is a
  predicate on a function whose meaning C5 changes. **This is the one dependency
  that gates the start.**
- **C6 does not gate anything but must be recorded.** C6 fixes three grammar bugs
  and ships the tier-potion widening, i.e. it changes which candidates exist. The
  lens's O1 measurement (emissions, clusters, coverage curve) must be taken
  **after** C6, or it measures a candidate set that no longer exists.
- **C7 (the legacy rip) gates the lens's UI and storage commits**, because both
  branches edit `active-game-manager.ts`, `firebase-interface.ts`,
  `decision-logger.ts` and `src/web/play-game.html`. The rewrite's L track is
  smaller and merges first by its own §6.2; the lens takes those files after it.
- **The lens's test bulk-delete may run before either**, on one condition: it
  must take only the **residue** of the rewrite's C2 delete list. `territory.test.ts`,
  `territory-slider.test.ts`, `voronoi-strategy.test.ts`, `fatal-path-projection.test.ts`
  and `decision-iterative.test.ts` are on the rewrite's list; the lens must not
  delete them, or the two branches conflict on files whose whole value is that
  their deletion changes no source.
- **One asymmetric dependency inside the deletes**: the lens deletes
  `src/tests/unit-inspection.test.ts`, whose `{sources, owner, distance}`
  assertion the rewrite explicitly re-homes into a new
  `src/tests/territory-view.test.ts` (ONE-ENGINE §4b). The lens's delete is legal
  only **after** that file exists, or the assertion is lost between two branches
  each believing the other kept it.

**Summary order:** rewrite `E → T → {B ∥ L} → C8`, then lens
`test-delete → boundary tests → {kernel ∥ storage ∥ UI} → integration`, with the
lens's test-delete permitted to run concurrently with the rewrite's B/L tracks
and everything else after C7. Nothing in the lens is on the rewrite's critical
path, and nothing in the rewrite waits on the lens.

### 6.3 Two divergences to declare at rebase

1. The lens deletes `src/logic/decision-telemetry.ts` (§5.1 #6); the rewrite lists
   it *unchanged*. No conflict — the rewrite makes no edit — but the rebase must
   not silently resurrect it.
2. The lens's §5.1 #2 deletes the stored territory blobs; the rewrite's §3.3
   creates `logic/territory-view.ts` to answer the same question on demand. These
   agree, and the lens's Alt+click exception (§5.3 #14) is the consumer the
   rewrite's new file was written for. State it at rebase so neither branch
   deletes the other's half.

---

## 7. What is now settled, in one place

- A cluster is a connected component of the occupancy-reach graph over the units
  the bot may still move, **no hub fiat**; identity is anchor-name + content-hash
  + lineage; locking narrows and unlocking widens, in that direction only.
- The moveset is the row, retained in a `k=5` reservoir where `better()` already
  compares, at zero evaluations, each row carrying the refusal branch that made
  it a runner-up; its number is a whole-board bracket in a three-coordinate fiber
  (basis, generation, complement).
- The conditional ranking is the speculative pin context, its head is `conform`,
  and a lock promotes the same cache entry — so inspection and action are one
  object. A lock pins every differing member; `minimalPinSet` is not built.
- One `TurnEvent` type, two producers, one pure reducer, two sources; frames are
  stored, re-run is the CI audit, provenance is a badge.
- Five tables; `movesets` is a materialised projection with a rebuild command;
  `command_turn_states` and `decision_logs` are gone.
- 26 questions answered, 5 measured by one instrumented run, 2 deferred behind a
  named trigger.
- The whole thing rebases after the rewrite's C5.
