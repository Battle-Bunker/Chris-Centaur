# THE WORLDLINE FACTORIZATION — computational time as a first-class joint

Design lens: TIME — the computational-time structure of an anytime,
interruptible, re-basing search. One of four parallel architecture-design
threads under the 2026-09-01 factorization mandate.

Grounded on `claude/cluster-lookahead` @ `47c983e` (post toll-fix, post
loop-telemetry; read in `$SP/cl-main`), `origin/primary` @ `66904d2`, and
TacticToes @ `416d9c8`. Builds on, and deliberately does not repeat,
`$SP/rebase-transfer-design.md` (the carry-store semantics) and
`$SP/interruption-architecture-design.md` (the event loop mechanics); where
this document disagrees with or supersedes those, it says so explicitly.

---

## 0. The claim in one paragraph

The domain has exactly two kinds of time, and the current architecture
tangles them. **Information time** advances only by discrete DETERMINATIONS —
events that convert some previously-uncertain variable of the world into
fact (an operator commit, a turn resolution, a spawn observation, a future
partial reveal). **Compute time** advances only by WORK QUANTA — priced
resolutions, plies, slices — spent refining beliefs about a world whose
determination state is momentarily fixed. Every mechanism the program has
built or designed — the anytime slice, the constraint epoch, the ponder
window, the re-base, the speculative pin context, the scout thread — is one
of two operations: **spend quanta against a (possibly hypothetical)
determination frontier**, or **advance the frontier by a determination and
keep exactly the state whose citations survive**. A factorization that makes
those two operations the only primitives — a per-game WORLDLINE that owns
the frontier, the stores, and the attention map; per-turn COMMITMENT AGENTS
that own deadlines, wire, and emit gates; and one EXCHANGE-RATE adapter that
owns every clock read — makes the four "mechanisms" four parameterizations
of one thing, makes fog-across-turns the general case rather than a second
code path, gives the operator's multi-turn goto its first honest home, and
turns two of the three pending owner rulings into non-questions.

---

## 1. The reality joint, argued from the domain rather than the code

Why is "determination vs. quantum" a joint of the DOMAIN and not just a
tidy abstraction?

1. **The game is simultaneous-move over a discrete wire.** Nothing about
   the world changes continuously. Between two Firestore snapshots the world
   is EXACTLY constant; at a snapshot it changes by a discrete, enumerable
   delta (a staged-move status, a resolved turn). There is no third kind of
   world change. This is not true of, say, a robot; it is true of this game,
   which is why the joint is deep here.
2. **The centaur design makes determinations arrive mid-computation by
   intent, not by accident.** Operators pin and commit whenever they please;
   opponents commit whenever they please; the server resolves the instant
   the last commit lands. The set of determination SOURCES is fixed
   (operator, rivals, server, scheduler) but their TIMING is adversarial or
   human — i.e. wall-clock-random. Any architecture that couples the search
   state's validity to wall-clock structure (a "turn call", a "window") is
   fighting the domain; one that couples validity to the determination
   frontier is aligned with it.
3. **Every uncertain variable is already one of two shapes.** A variable is
   either DETERMINED (a fact on the frontier) or held as a CLOUD (a sound
   over-approximation that dilates with game-time distance). The door's
   three shells (`scout/door.ts:13-28`), the reference-action mechanism, the
   pin set, and the planned invisibility fog are all instances. There is no
   third shape anywhere in the program, and the owner's fog ruling (pin 20)
   guarantees the two-shape world is permanent.
4. **The score of compute is separable from the clock of compute.** The
   scout already proved this: it spends in resolution-equivalents, never
   reads a clock (`scout/schedule.ts:143-190`), and its findings are a pure
   function of (seeds, allowance). The kernel's slice loop proved the
   converse: everything that reads the wall clock directly (slice count,
   178/177/178) is unreproducible. The joint between them is exactly ONE
   number — how many quanta a stretch of wall time buys — and the program
   already named it (`msPerResolution`) and already knows it is mis-fit
   (0.15 configured vs 1.1–4.2 measured). The factorization's job is to make
   that single number the ONLY place the two times touch.

So: the deep joints are (a) the determination frontier as the key of all
search state, (b) the quantum as the unit of all search work, and (c) the
exchange rate as the single bridge. Everything else in this document is
those three joints applied.

### 1.1 The five time-scales, inventoried

| world time            | compute time             | bridge |
|-----------------------|--------------------------|--------|
| sub-step (collision tick, `turnEngine.ts` snapshot→resolve→apply) | quantum (one priced resolution-equivalent) | none — never compared |
| turn (decision cadence, deadline) | tranche (a granted allowance of quanta: today's "slice") | the exchange rate, read once per tranche grant |
| game (metric horizon, turn limit) | window (the quanta available between two determinations) | telemetry only |

The table's discipline: a bridge row that is "none" is an invariant — no
code may compare a sub-step to a millisecond; the one legal bridge is the
exchange rate at tranche-grant time. Today's kernel violates the discipline
in one place only (slices are wall-clock-cut mid-work), and that violation
is the entire slice-count mystery.

---

## 2. The unified state object: a partial world, and who supplies certainty

A PARTIAL WORLD is (facts, clouds): a set of determined variables plus a
sound cloud per undetermined one. The program already has this object — it
is what an `EngineSubstrate` + held records IS — and already has the ONE
advance operator over it: `continueFrom(root, resolution, cluster)`
(`scout/door.ts:231`), which takes a resolved world and re-roots, carrying
facts (I1–I6, I9), dilating clouds by absolute-turn query (the one-line
`staleness: rootTurn − heldAtTurn` trick, door.ts:299-336), and naming what
it cannot carry (I7/I8 → `distrusted`).

The owner's sentence — "the same machinery that advances a held unit's
cloud in imagination should advance held units when reality determines
them" — is therefore not an aspiration; it is a statement about which
existing function gets a second caller. **Reality is a thread whose premise
is fact.** An imagined advance and a real one differ only in who supplies
the orders to `PartialEngine.resolve(state, orders)`:

| caller | orders supplied by | held set |
|---|---|---|
| scout thread ply | enumerated cluster joint + reference actions + clouds | everything outside the cluster |
| ponder ply | OUR committed plan (fact) + enemy reply hypothesis | uncommitted-unknown rivals |
| RE-BASE (new) | the REALIZED joint move, all units | ∅ today; the hidden units under future fog |
| operator commit | (not an advance — a narrowing of ply-1 variables; §4) | — |

### 2.1 VERIFIED: the wire already delivers the resolution record — the pending game-server ruling dissolves

`interruption-architecture-design.md` DILEMMA 3 held that the real turn
arrives as an `ApiBoard`, that the door deliberately accepts only
`Resolution`s, and that the clean fix needs TacticToes to emit a resolution
record — a game-server change requiring an owner ruling. Two facts, both
verified against source this session, shrink that dilemma to nearly
nothing:

1. **The `Turn` document already carries the resolution record's content.**
   `shared/types/Game.ts:145-181`: `deaths` (cell, subStep, cause — "the
   authoritative registry"), `clashes` (full typed `Clash` list with
   subStep, playerIDs, victimIDs, survivorID), `severedCells`, `moves`
   ("square each unit actually ended its move on — truncated sliders record
   their stop square"), `paths` (cells traversed, pieces), `orientation`
   (every unit, every game), `unitTypes` (promotions), plus food / hazards /
   potions / effects. This is `TurnResolution` (`engine/resolveTurn.ts:80-111`)
   minus only: settled `exhaustions`, `finalCell`, `vulnerableCollided`,
   `eliminatedTeamIDs`, `subStepCount` — every one of which is derivable
   from what is published (deaths carry cause and subStep; elimination is
   visible in deaths + alivePlayers).

2. **The bot can construct the door-consumable `Resolution` itself, by
   replaying its own engine over the realized orders.**
   `PartialEngine.resolve(state, orders)` (`partial-engine/engine.ts:1319`)
   takes a full per-slot order assignment over the previous root and
   returns exactly the `Resolution` the door consumes — state handle,
   fates, clashes, deaths, severedCells, ledger. The realized orders are
   recoverable from `Turn.moves` + `orientation` (a truncated slider's stop
   square regenerates the same path prefix through the movement grammar; a
   rotation is the no-move + orientation delta). The partial engine is the
   program's differentially-tested re-encoding of the vendored rules
   (refused-joints #3: "the one-turn forward model is an exact shared
   re-implementation, never a variant"), so this is NOT a second rules
   implementation — it is the first one, given a second caller.

The re-base path is therefore:

    realized = resolve(prevRoot.state, ordersFrom(turnDoc))     // engine-side
    checksum: realized.state  ==?  marshal(turnDoc)             // wire-side
      match    → continueFrom(prevRoot, realized, cluster=survivors) is the
                 new root; every thread premise is matched against realized
                 (rebase-transfer §2); attention carries.
      mismatch → fall back to today's marshal-from-wire root, drop carries,
                 count and log a `replay-divergence` (the differential test,
                 now running once per live turn for free).

**Precision on what replay covers (verified against `resolveTurn.ts:26-31`):**
the vendorable engine deliberately excludes the game-state half of a turn —
spawns (food/hazard/potion), potion pickup and tier/effect changes, the
orientation rewrite, pawn promotion, scoring. The same is true of the bot's
partial engine (the potion-intel pin: resolve never writes `U_TIER`; the
missing ~30 lines are collection above the resolver). So `realizedResolution`
is a SPLIT reconstruction: the movement/collision half is REPLAYED
engine-side (paths, contests, severs, deaths, exhaustion — the half that
needs simulation), and the game-state half is COPIED from the turn doc
(spawn cells, tiers, `activeEffects`, `unitTypes`, `orientation` — frontier
facts that need no simulation and are published outright). The checksum
covers the replayed half (occupancy + health + deaths field-by-field).

And a role correction relative to the first draft of this idea: under FULL
observability the new root's CONSTRUCTOR stays the battle-tested wire
marshal — replaying buys nothing there, since the doc determines the root
exactly. What the replayed `Resolution` is FOR, every turn, is (a) the
checksum (the free per-turn differential test), (b) premise-matching and
attention carry (deaths/clashes/severs in engine vocabulary are what
rebase-transfer §2 matches against), and (c) the semantics of "advance held
units by what reality did" — which becomes the ROOT constructor exactly
where observation is partial (future fog): hidden units enter as holds,
`resolve`-with-holds and `continueFrom`'s dilation carry them, and the doc's
visible facts intersect their clouds. The door is the advance operator
wherever certainty is partial; the marshal is its degenerate total-knowledge
limit.

Three consequences worth stating loudly:

- **The pending owner ruling "should TacticToes emit a resolution record?"
  is no longer load-bearing.** The unification does not wait on it. A
  TacticToes addition remains a nice-to-have (publish `subStepCount` and
  settled exhaustions verbatim; possibly a state hash to make the checksum
  one string compare), and it is additive, but nothing blocks on a
  game-server change.
- **The one-translation rule comes out STRONGER, not weakened.** Today the
  wire marshal is the constructor of every root; under replay-re-base the
  engine advances engine-side and the wire's role inverts into a per-turn
  CHECKSUM. Divergence cannot accumulate: it is caught the turn it happens,
  against the authoritative doc, and the fallback is exactly today's path.
- **Fog-across-turns (pin 20) is the same code path, not a second one.**
  Under invisibility potions the turn doc arrives NARROWED: some units'
  orders are unknowable. Then `ordersFrom` covers the visible units and the
  hidden ones stay HELD — `resolve` with holds is precisely the engine's
  existing partial mode, and `continueFrom` dilates their clouds exactly as
  it does for imagined plies, intersected with whatever the doc did reveal.
  Full observability is the degenerate case (holds = ∅). The E5 warning in
  the interruption doc ("build intersection as the general case or write
  the re-basing path twice") is discharged by construction.

---

## 3. The four mechanisms as one operation

Two primitives:

    spend(worldline, tranche, hypothesis)  →  findings, attention updates
    observe(worldline, determination)      →  frontier′, surviving state

where a HYPOTHESIS names a conditional frontier — the actual one, or the
actual one plus assumed determinations — and a DETERMINATION is one of:

| determination | variables it determines | today's name |
|---|---|---|
| operator pin (revocable) | none — a CONSTRAINT on our choice, not a world fact | PinEvent pin/unpin |
| operator commit | one of OUR units' turn-N action | PinEvent commit |
| rival commit visible | the TIMING of a rival's action (never content) | moveStatuses (filtered out today) |
| turn resolution | every unit's turn-N action + resolution consequences + spawns; advances world time | new decideTurn |
| partial resolution (future fog) | a SUBSET of the above; clouds intersect | — |
| goto / dial | none — a change to the OBJECTIVE, not the world | — (does not arrive) |

And the existing mechanisms, re-read as parameterizations:

| mechanism | is | parameters |
|---|---|---|
| anytime slice | `spend` with a commitment agent attached | tranche size (adaptive), hypothesis = actual frontier |
| speculative pin slice | `spend` on hypothesis = actual + assumed pin | `speculativePeriod` (1-in-N tranches) |
| scout thread ply | `spend` on hypothesis = actual + assumed cluster joint | tithe, depthMax, plyCap |
| ponder | `spend` with no agent attached; hypothesis = actual (our commits are FACTS now) + reply hypotheses | window allowance policy (§6) |
| constraint epoch | `observe(commit)` → citation-scoped invalidation + immediate conform | reaction policy per class (§5) |
| re-base | `observe(turn resolution)` → door advance + premise matching + attention carry | carry policy (rebase-transfer) |
| dial change | `observe(objective change)` → re-key values by evaluator version, keep world state | §7 |

The rows share one law, which is the whole point: **what survives an
`observe` is decided by CITATIONS, never by event kind** (§5). The rows
share one budget law: **every `spend` is denominated in quanta from an
allowance whose grant is the only clock read** (§6).

### 3.1 Conditional frontiers unify three things the program built separately

A speculative pin context (kernel tier-3 cache), a scout thread premise
(threadKey), and a ponder reply target are the SAME object: a hypothesis =
(frontier + assumed determinations), with search state keyed by it, priced
by the same machinery, and adjudicated by the same compatibility test when
reality lands (assumed = realized → promote to actual, keep everything;
contradicted → citation-death). The pin-context cache's `resumedFromCache`,
the thread ledger's premise matching, and rebase-transfer's carry-match are
three implementations of one promotion rule. Naming the object once means:

- ponder targets get the pin-context treatment for free (a pondered reply
  that the opponent then plays is a RESUMED context, warm, not a carried
  scalar — strictly stronger than the carry-store where the premise matched
  exactly and the substrate survived);
- the operator's TENTATIVE pin exploration and the scout's reply
  exploration compete in one attention market instead of two rationed
  pools (`speculativePeriod` and `tithe` become two rows of one policy);
- "which hypothesis earns the next tranche" is the single scheduling
  question, and D8's whole surface (escalation triggers, focus narrowing,
  per-enemy exact-modeling) parameterizes it.

One caveat carried from rebase-transfer §7/§1: hypothesis-conditional VALUE
never crosses to the actual frontier except through the advisory channel;
the sound channel restarts from facts. The unification is of attention and
lifecycle, not of floors.

---

## 4. The three-part split: Worldline / CommitmentAgent / ExchangeRate

What the factorization does to the module map. Today's kernel is three
things fused: an event loop + invalidation policy (frontier logic), an
emit-gate/ratchet/wire discipline (commitment logic), and a clock/budget
apparatus (time logic). The seams:

**WORLDLINE (per game, lives for the game).** Owns: the determination
frontier; the partial-world root (substrate) and its advance; the
hypothesis table (pin contexts + thread premises + ponder targets, one
store); the attention map (carried rows per rebase-transfer §1); the
allowance ledger (§6); the per-game seed stream; the structural caches
keyed by citation. Absorbs from today: `GameState_` (already the sanctioned
cross-turn seam — ledger, stepCostMs, latestTurn, matchSeed, live handle),
the session store's structural half, the scout ledger, the carry store.
API: `observe(determination)`, `spend(tranche, hypothesis?)`, and read
surfaces for agents.

**COMMITMENT AGENT (per turn, lives for the turn).** Owns: the deadline;
the wire plan and write rate; the ratchet basis and the five emit gates;
conformance (splice pins into the wire plan, kernel.ts:1203); the
staged-nothing guarantee; the final flush. It is a CONSUMER of the
worldline: each tranche's findings update the candidate rows it stages
from. It is the only module that knows what a deadline is. Absorbs from
today: the kernel's basis/stager/gates/journal and rung-0 contract —
roughly kernel.ts minus the improve loop's ownership of search state.

**EXCHANGE RATE (per process, stateless + measured).** Owns every wall
clock read. Converts (deadline, now) → allowance grants; meters observed
quanta-per-ms per game (the way `stepCostMs` is already carried per game,
team-decision-engine.ts:416-421) and re-fits continuously; stamps every
grant into the allowance ledger. The scout's `msPerResolution` deferral
(0.15 vs 1.1–4.2 measured, schedule.ts:162-190) stops being a constant and
becomes this module's fitted value — with the fit's change-of-behavior
priced as its own arm exactly as the toll-fix note prescribes.

The wire adapter shrinks to a DETERMINATION SOURCE: it translates Firestore
snapshots into the determination union (and removes the `ours` filter on
`moveStatuses` so rival-commit timing reaches the worldline). The search
core's session becomes the worldline's value-store for one hypothesis
(bank + memo keyed by (hypothesis, evaluator version)); `open()` splits
into the structural half (worldline-owned, citation-keyed) and the value
half (hypothesis-keyed) — the same split the toll fix's per-cluster state
already prepared (25f1629's "no global cursor; cross-epoch reuse is not
built and the seam is documented in code").

What does NOT move: the sound machinery (bank laws, refusal algebra,
witness discipline) is untouched in content; it changes key shape only
(§5). The safety floor stays in the commitment agent's staging path.

---

## 5. Invalidation by citation, not by kind

The interruption doc's three-axis event classification (deadline class /
scope / base-change) put SCOPE on the event as a declared property. The
deeper cut: scope is DERIVED. Every value-bearing store in the program
already carries its dependence footprint —

- pin-context entries: `citedUnits` (kernel.ts:262, invalidateCitingUnit :351),
- bank rows: `bounds.ledger` per-unit citations,
- thread entries: premise + `citedUnits` + `invalidateCitingUnit`
  (threads.ts:497-514),
- carried rows: `citedUnits` (rebase-transfer §1.2),
- cluster enumerations: the cluster's member set,
- candidate sets: the unit itself + geometry.

The law: **`observe(d)` kills exactly the state whose citations intersect
the variables `d` determined (or whose hypothesis contradicts `d`), and
nothing else.** Consequences, in order of value:

1. **The 343 ms commit toll dies structurally, not by patch.** A commit
   determines one unit's action. Candidate sets of other units cite it not;
   the enumeration of a cluster not containing it cites it not; the bank
   rows citing it die; the rest live. The interruption doc's DILEMMA 1 fix
   (split openStructure/openValues, re-enumerate one cluster) becomes the
   n=1 case of the general rule rather than a special path. The session key
   `JSON.stringify(basisOf(ctx))` — the reason a commit kills everything —
   is replaced by (hypothesis id, evaluator version) with per-entry
   citations doing the fine-grained work.
2. **Re-base is the same rule at n=all, plus a root advance.** Everything
   citing any turn-N action dies (which is: every ply-1 value); structural
   state citing only geometry survives where the geometry survived; the
   attention map survives by premise-match. No new invalidation concept.
3. **Fog re-base is the same rule at n=some.** State citing only
   still-hidden units' actions is NOT killed — it remains
   hypothesis-conditional, exactly what it was before the turn. This is the
   flexibility dividend: the carry-store's all-or-nothing compatibility
   test generalizes to per-variable survival with zero new machinery,
   because citations were per-variable all along.
4. **The event union stays open.** A new determination kind (say, a rules
   change mid-season, or a mid-turn reveal) needs a variables-determined
   list and nothing else; no handler taxonomy grows.

Two laws added by the prior-art pass (`time-prior-art.md` A3.1–A3.2):

- **CUTOFF.** Invalidation stops where recomputation yields an equal value
  (Salsa backdating, Incremental cutoff). Where re-derivation is cheap,
  observe() recomputes-and-compares BEFORE propagating; equal ⇒ downstream
  stands. The paying case: an operator commit of a unit's ALREADY-STAGED
  destination — a human approving the bot's move — contradicts nothing and
  must cost one equality check plus removing a variable; today it pays a
  full epoch teardown (applyPinEvents sets epochChanged unconditionally).
- **DURABILITY STRATA.** Citations are grouped by change-frequency class —
  geometry (game-constant) / positions (per-turn) / actions (per-event) /
  objective (per-dial) — and observe() walks only the touched class's
  index. Granularity is class + cluster + unit, never per-cell
  (Incremental's node-cost warning; also discharges the joints lens's
  premise-id churn risk, their §5.1 stable/volatile split).

What stays declared rather than derived: the REACTION policy — how fast a
commitment agent must respond (conform-now / next-tranche /
next-commitment). That is genuinely a policy about obligations to humans,
not a fact about state validity, and it lives on the commitment agent as a
small table (per determination source). "Humans always win" is one row.

Hazard, named honestly (rebase-transfer DILEMMA 1 carries over): citations
guard validity, not soundness — cross-frontier value smuggling is still
prevented only by type + the rootTurn tripwire, because the basis
vocabulary has no board identity. This factorization does not fix that and
must not claim to; it narrows the smuggling surface to one module
(worldline promotion) where the tripwire lives.

---

## 6. Time discipline: the allowance ledger, and determinism as a ledger property

The rule the scout already obeys, promoted to the whole search: **no layer
below the exchange rate reads a clock; every spend is quanta against a
granted allowance.** The grant events form the ALLOWANCE LEDGER:

    { seq, gameId, targetTurn, phase: conform|refine|ponder|speculative,
      hypothesisId?, granted, spent, msObserved /* telemetry only */ }

with determinations interleaved at their LOGICAL POSITION (after grant k,
before grant k+1 — the position-not-time discipline of interruption §4.2,
now with a smaller domain: positions are between tranches, and a tranche is
atomic by construction because nothing inside it can see the clock).

What this buys, dilemma by dilemma:

1. **The ponder-determinism trade (pending owner ruling 3) dissolves into a
   logging question.** Fixed-allowance ponder and spend-all-idle ponder
   differ only in how `granted` is computed at the window; BOTH are exactly
   replayable from the ledger, because the ledger records what was granted.
   Live play runs spend-all (strength); replay injects the recorded grants
   (exactness); paired sweeps run fixed grants (comparability) — and can
   additionally run grants SAMPLED from live-telemetry window distributions
   to test the live configuration's shape. The harness's virtual decision
   clock (interruption §4.4) is this ledger with `msObserved` synthesized.
   What remains genuinely unavailable is predicting a specific live
   opponent's thinking time — which no architecture can supply.
2. **The measurement-denominator break (interruption DILEMMA 4) gets its
   accounting.** Every quantum is stamped with the turn it was spent TOWARD
   (`targetTurn`): ponder after committing turn N targets N+1. Per-turn
   metrics keep their denominator (tranches targeting N); cross-arm
   comparisons gain one honest new column, `carriedQuanta` (ponder inherited
   by N), and arms with different ponder policies are compared BOTH at equal
   wall budget and at equal total quanta — two questions, named as two. No
   historical number silently changes meaning: refine-phase quanta at a
   given budget are today's numbers.
3. **The slice-count mystery stops mattering.** Slice count was
   wall-cut and unreproducible; tranche count is ledger-cut. The 178/177/178
   family becomes: same ledger → same everything; different ledger → the
   ledger says exactly where the runs diverged. Tier-A decision replay
   (interruption §4.3) strengthens toward Tier-B without localizing the old
   mystery, because the old mystery's cause (mid-work wall cuts) is removed
   rather than explained.
4. **The anti-latch discipline survives the move to a long-lived process.**
   The arena latch class (kernel.ts:8-24) was module-scope cost estimators
   outliving their measurements. Law, carried into the worldline: the ONLY
   mutable cross-turn scalars are (a) the exchange-rate fit and `stepCostMs`
   (already guarded by turn stamps), (b) attention rows with `rootTurn`
   tripwires and plies-bounded lifetimes, (c) the seed stream position.
   Every estimator, threshold, and ratchet is per-tranche-context or
   per-agent. A worldline holds knowledge and appetite, never calibration.

**Feasibility of the counting cut (verified):** the bank consults the clock
at exactly five `shouldStop()` points inside its ladder (`bounds/bank.ts:688,
716, 726, 746` + the price-entry check), all through the injected
`BudgetHandle` — and `bounds/testkit.ts:723` already ships `countingBudget`,
a handle that spends by count. The tranche cut is therefore a HANDLE SWAP,
not a bank rewrite: the exchange rate grants N quanta, the handle counts
prices, the wall clock is read only at grant and at the commitment agent's
own deadline checks. The scout needs nothing (it already counts); the
refiner's lever loop needs the same swap.

Tranche sizing: today's adaptive slice (`sliceMs` floor, measured-cost
factor, `maxSliceFraction` cap) translates directly — the cap becomes "no
tranche may be granted more quanta than the exchange rate prices the
operator-latency bound at", which keeps the humans-always-win latency bound
while making the bound itself a POLICY number on the commitment agent (and
p99-gated per interruption §3.3).

---

## 7. Objective changes are a different axis: the evaluator version

A dial change determines nothing about the world; it re-prices it. Keying
values by (hypothesis, EVALUATOR VERSION) — the `evaluationIdentity`
machinery raised to a first-class key component, as interruption DILEMMA 2
proposed — separates the axes cleanly. The pending owner ruling ("does the
dial promise mean next turn or next slice?") then gets a third answer that
is better than both: **next tranche, softly.** A dial bump mints a new
version; stores under the old version are not destroyed but DEMOTED to
shadow-priors (the same posture the carry store takes toward last turn's
values: advisory ordering weight, zero sound content); re-pricing under the
new version happens through ordinary spending, concentrated where the
attention map says the decision lives. The wire is re-conformed immediately
under the new version's pricing of the incumbent (cheap — one plan), so no
emitted record ever mixes versions. Cost: version stamps on bounds
(one small field, already namespaced in the memo); benefit: the dial
promise is met at tranche latency without a stop-the-world re-price, and
the measurement-attribution argument ("a value that can change under a
running match is a value no measurement can be attributed to",
team-decision-engine.ts:508-527) is preserved BY the stamps rather than by
constructor freezing.

The goto (E3) finally gets its home: it is a standing objective term ON THE
WORLDLINE — the one operator statement that is multi-turn by nature lands
in the one store that is multi-turn by nature, as an evaluator-row
multiplier under the current version, surviving re-bases untouched because
it cites no world variable. (Lane-a: an evaluator entry; no architecture
needed beyond the worldline existing.)

---

## 8. What the factorization opens (beyond the DoF already tried)

- **Fog across real turns** (pin 20): native. Partial determinations are
  the general `observe`; hidden units stay held across the boundary;
  per-variable citation survival replaces all-or-nothing carry matching.
- **Ponder targeting under ruling 13**: the hypothesis table makes the
  worst-case-witness targets (rebase-transfer §6.2) one policy among
  several, and when the owner later fills the D2 opponent socket, its
  output plugs in as hypothesis WEIGHTS — the socket boundary is exactly
  the hypothesis-selection policy, one joint, already parameterized.
- **Focus narrowing (ruling 41)**: "acute" = a carried concern row's
  premise matched reality = a hypothesis promotion event; the
  posture-like modulation (tithe up, breadth down) is a scheduling policy
  row reading promotion events. No new trigger machinery.
- **Compute scaling / multi-game**: worldlines are per-game and
  independent; commitment agents attach per turn; parallel workers already
  preempt by epoch table. Nothing in the factorization assumes one live
  decision per process — the overlap the turn-keyed `live` handle defends
  against today becomes the normal shape.
- **Operator UX growth**: tentative-pin exploration, "what if I commit
  this" previews, and bot advice on pins are all reads of the hypothesis
  table — the speculative machinery stops being a kernel special case.
- **Per-decision compute sequencing as a tunable joint** (the mandate's
  question): the whole surface is now four named policies — tranche
  sizing (agent), allowance split across phases (worldline), hypothesis
  selection (worldline), reaction table (agent) — each a config value on
  BotConfig, each sweepable as a batch arm, none a flag.

---

## 8½. Convergence with the epistemics carve (design/belief-fog), and one named mismatch

The epistemics thread's cycle-1 object (`docs/design/belief-fog/00-THE-OBJECT.md`
on `design/belief-fog`) — belief as **(S, w)**, support moved only by
`condition(dilate(S), obs)`, weight moved by any evidence at earned
precision — is the STATE this document's worldline holds. The two carves
compose rather than compete, and the composition is sharper than either
alone:

1. **`observe(d)` decomposes into their operator plus this document's
   survival rule.** A determination first conditions the belief object
   (their §5 — the same bitboard intersection for a partial obs as for a
   total one), then kills/promotes the DERIVED stores — values,
   enumerations, attention, hypotheses — by citation (§5 here). Their doc
   governs what the world-belief becomes; this one governs what happens to
   everything computed FROM it. Neither half is complete without the other:
   conditioning without citation-survival re-derives everything (today's
   343 ms); survival without conditioning is the smuggling bug class.

2. **Their reducibility tag is the TYPE of this document's spend/observe
   dichotomy.** L5 tags every held width with its removal operation:
   by-compute / by-observation / none-this-turn. In worldline terms:
   by-compute widths are `spend` targets (VOI buys them down);
   by-observation widths are FUTURE DETERMINATIONS with an arrival
   schedule — simultaneity width resolves at the turn boundary (arrival
   time known, value unknown), invisibility width resolves at re-sighting
   (neither known). The allowance/hypothesis machinery is exactly the
   economics of the second column: the ponder policy IS "how much to
   pre-spend across hypothesized resolutions of an observation-reducible
   width whose arrival is scheduled".

   **The mismatch, named precisely:** their table's third column reads
   "observation fog — nothing purchasable this turn". True for the width
   itself; NOT true for compute against it. A conditional frontier lets the
   scheduler pre-spend on hypothesized reveals — buying not width but
   REACTION LATENCY (the branch is already explored when the reveal lands).
   The tag must therefore gate "VOI may not claim to narrow this width by
   compute" while leaving "the hypothesis market may hedge across its
   outcomes" open — two different purchases, and only the first is
   forbidden. If the tag's consumers conflate them, ponder becomes
   untypeable the day fog lands.

3. **Their declared read-sets and this document's citations are one
   declaration record with two axes.** Their §6 has every comparator
   declare which PROJECTIONS it reads (horizon, weight-id, basis); §5 here
   has every store declare which WORLD VARIABLES it cites. Merge them:

       ReadSet = { coords: variables of S read (unit-action@turn,
                   position@turn, spawn-cell, …),
                   horizon, weightId, evalVersion, hypothesisId }

   Invalidation on `observe` reads `coords`; comparison refusal reads the
   tag half (their L4); dial demotion (§7 here) reads `evalVersion`. This
   materially improves this document's weakest point (§9.2, citation
   completeness): the tag half already has enforcement teeth (the bank's
   basis-mismatch refusal), so folding `coords` into the same record
   inherits an enforced discipline instead of inventing a convention. One
   record, three readers, no second table.

4. **Their weight-supplier ladder (W0–W4) is the hypothesis-weighting
   plug-in of §8 here.** The socket accepting "quantifiers and measures"
   is, on this side, the hypothesis market accepting worst-case target
   lists (W0 = witnesses), cover-counting weights (W2), and later learned
   weights (W4) as the SAME input shape. The two documents point at one
   joint from its two faces: what the weights MEAN (theirs), and what
   compute they steer (this one).

---

## 9. Honest costs and hazards

1. **The refusal algebra still does not know about turns.** Carried
   forward from rebase-transfer DILEMMA 1 unchanged; the worldline narrows
   the surface but the first value-bearing object guarded by convention
   remains guarded by convention.
2. **Citation completeness becomes load-bearing.** Today a missing
   citation costs a stale cache entry INSIDE one decision; under
   citation-scoped invalidation it costs correctness ACROSS a
   determination. Mitigation: the checksum re-base (any drift → wire
   fallback), the tripwire stamps, and a conservative default (state with
   no citation record dies on every observe — opt INTO survival).
3. **The commit-toll fix must precede the worldline, not ride it.** The
   per-cluster seam the toll fix left ("cross-epoch reuse not built") is
   the first increment and is valuable standalone; the worldline is worth
   building only on top of its measured win (interruption Increment 1's
   acceptance game stands unchanged).
4. **Two-lane compliance**: everything here is lane (b) — feature branches,
   validated, merged; the policies named in §8 are lane (a) config once the
   joints exist. No flags anywhere; old session/slice code is DELETED on
   merge per docs/REFACTORING.md.
5. **The denominator change needs the owner's eyes before the first ponder
   experiment** (interruption DILEMMA 4's ruling request stands — §6.2 is
   this thread's proposed accounting, not a settled ruling).

---

## 10. Increment map (each a feature branch; ordered by standalone value)

1. **feature/commit-scope** — citation-scoped invalidation for operator
   commits (openStructure/openValues split over the toll fix's per-cluster
   state); DecisionEvent union + reaction table; the acceptance game (king
   committed at slice 8: conform ≤1 tranche AND keep improving others).
   Converts DILEMMA 1 into a number. No cross-turn state.
2. **feature/allowance-ledger** — quanta accounting + exchange-rate module +
   ledger rows in replay + harness virtual clock. Telemetry-only first
   (behavior byte-identical gate), then tranche-cut migration as its own
   arm. Fixes the fixable half of determinism before any cross-turn state
   exists.
3. **feature/replay-rebase** — `realizedResolution` (replay + checksum) as
   the root constructor, wire marshal as fallback; `replay-divergence`
   counter. Standalone win: the per-turn differential test of the partial
   engine against production, free.
4. **feature/worldline** — the per-game object absorbing GameState_ +
   hypothesis table + attention carry (rebase-transfer's store) + ponder
   tranches on the everythingPinned condition (kernel.ts:1224 already
   detects the entry). Measured by carryEffectRate + ponderReadAfterRebase
   + the two-turn acceptance games of rebase-transfer §9.
5. **feature/evaluator-version** — version stamps + soft re-price; the
   dial acceptance game (dial flip mid-decision: wire conforms within a
   tranche; ordering converges without a session teardown).

---

## 11. For the owner (short)

- The game-server resolution-record question is dissolved: the turn
  document already carries the record, and the bot can replay its own
  engine to reconstruct the exact object the advance machinery consumes,
  with the wire as a per-turn checksum. A small additive TacticToes
  publish (sub-step count, settled exhaustions) is optional polish.
- The dial-latency question gets a third option: next-tranche-softly via
  evaluator versions — old values demoted to advisory shadows, wire
  re-conformed immediately, full re-price flowing through normal spending.
- The ponder determinism question becomes an accounting rule: grant
  allowances, log them, replay the log; run sweeps on fixed grants and on
  grants sampled from live window telemetry. One ruling still genuinely
  needed: the per-turn measurement denominator under carried compute
  (§6.2's two-column proposal).
