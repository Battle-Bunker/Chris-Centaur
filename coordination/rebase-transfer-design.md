<!-- SNAPSHOT: source scratchpad/rebase-transfer-design.md — synced 2026-09-01T01:13:23Z by the branch-topology housekeeping task.
     This is a point-in-time copy, not the live document. The working copy is the coordinator's
     scratchpad; this branch exists so the owner can reach it if that box is unreachable. -->

# SCORE-TRANSFER / RE-BASING — design for the owner's restart-with-retained-priors paradigm

Grounded in `claude/cluster-lookahead` at origin tip ecf5609 ("A pickup can be
ordered as a gain"), read in worktree `$SP/rebase-read`. All paths below are
relative to the repo root; line numbers are from that tip.

THE SPEC (owner's paradigm, condensed): across turns and interruptions, actual
simulation RESTARTS on the new deterministically-known state; quality/
interestingness scores over branch candidates from partial-board explorations
COMPATIBLE with the new state are KEPT, to concentrate compute from the new
checkpoint. Concern sets transfer; productive-branch priorities transfer. The
same machinery that advances a held unit's cloud in imagination advances held
units when reality/operator commitment determines them. Pause at the leaves of
the advanced branch; restart from the new base with retained branch-quality
knowledge (exploitation AND exploration value) filtering the new search.

## 0. The lifetime map today (what dies at each boundary)

Everything value-bearing currently dies with the DECISION:

- The search SESSION (candidate sets, bound bank, resolution memo, eval memo,
  sampler, edge store, scout+thread ledger, belief posteriors) is keyed by
  basis and additionally requires the SAME substrate object —
  `src/lobster/search/core.ts:618` (`sessions` map), `:667` (`hit.sub ===
  ctx.sub` guard). A new turn marshals a new substrate, so nothing survives.
- A fresh `SearchCore` is built per decision (`src/lobster/
  team-decision-engine.ts:757`, `buildCore(...)`).
- The scout's `ThreadLedger` "survives" only across SLICES of one decision
  (`src/lobster/search/scout/scout.ts:308-318`, `beginDecision` keeps the
  ledger, rebuilds the purse; publications are cleared per decision at
  `:361-366`).
- The ONLY cross-turn state is `GameState_` (`src/lobster/
  team-decision-engine.ts:413-443`): pin ledger, `stepCostMs`, `latestTurn`,
  `dropsReported`, `matchSeed`. Five scalars and a ledger. This is also the
  seam the codebase itself has already designated for cross-turn stores:
  `src/lobster/search/edge-ev.ts:308-316` ("Observed spawns need a cross-turn
  ledger... the seam is TeamDecisionEngine's per-game state").

The re-basing PRECEDENT already in the code is the constraint-epoch machinery
(`src/lobster/kernel.ts:26-40, 1403-1415`): on a committed pin event the
kernel (a) replaces the single `RatchetBasis` object (`newBasis`,
kernel.ts:677-715 — no map from epoch to floor exists, so cross-epoch
comparison is UNREPRESENTABLE), (b) clears `run.plans` outright ("Plans proved
under the old pins are not comparable under the new ones", kernel.ts:1411-1413),
(c) REPAIRS the wire plan by splicing pins into what the wire already holds
rather than rebuilding from the generator's first candidates
(kernel.ts:1167-1169), and (d) RESUMES the pin-context entry when the new pin
set matches a cached one (`PinContextCache.obtain`, kernel.ts:303-317,
`resumedFromCache`). That is exactly the owner's shape, one level down:
**values are dropped; identity, incumbency and attention are retained; repair
precedes refinement.** The cross-turn design below is that shape lifted one
level up, with the same division.

## 1. WHAT TRANSFERS AND WHAT MUST NOT (Q1)

### 1.1 What must not transfer — and the refusal is NOT free

Must not transfer: any `Bound`, `ScoreBounds`, `BankResult`, witness set,
ratchet floor, or memo entry. Three independent reasons, each grounded:

1. A bound is a ONE-PLY FRAME value on a specific board under a specific
   basis (`src/lobster/belief.ts:44-49`); the board is gone.
2. Witnesses and ledgers cite units at cells at sub-steps of the OLD turn
   (`src/lobster/bounds/score.ts:182-184`, `ledgerKey` =
   `unitId:cell:subStep:polarity`); on the new board they are statements about
   a world that no longer exists (the exact argument
   `PinContextCache.invalidateCitingUnit` and
   `ThreadLedger.invalidateCitingUnit` already make —
   `src/lobster/search/scout/threads.ts:497-514`).
3. **VERIFIED, AND THE ANSWER IS NO: the bank's cross-basis refusal does NOT
   give cross-turn refusal for free.** The basis vocabulary
   (`assumptionKey`, score.ts:58-69) contains pins, reference actions,
   narrowings and posture — NO turn number, NO board identity. Two decisions
   on different turns with the same (frequently empty) assumption set produce
   IDENTICAL basis keys, so `compareFloors`/`dominates`/`tighten`
   (score.ts:427-484) would happily compare a smuggled old-turn bound with a
   new one. The eval memo says this about itself in as many words: "What the
   key cannot express is two substrates that are not the same board"
   (`src/lobster/bounds/evalmemo.ts:66-70` — audit mode exists precisely
   because the key can't). Today's safety is LIFETIME safety (§0), and the
   transfer store is precisely a decision to breach that lifetime.

   Consequence: the guard must be STRUCTURAL — by TYPE, on the edge-EV
   precedent. `EdgeKey` is a branded string ("never a plan key, and the type
   is the enforcement... the mistake would otherwise typecheck",
   edge-ev.ts:253-261), and `belief.ts` is import-banned from
   `bounds/**`/`search/**`/`evaluate/**`/`selection/**` by eslint
   (belief.ts:31-37). The transfer store's row type must be constructible
   ONLY from plain numbers + ids (never wrapping a `ScoreBounds`), addressed
   only by its own branded key, and its one consumer must be the belief/
   ordering channel. Additionally, stamp `rootTurn` into the row and assert
   `row.rootTurn === sub.turn - 1` at fold time — a one-line tripwire for the
   laundering the type can't catch (a row carried two turns without re-basing).

### 1.2 What transfers — the object, precisely

One store, two views, one row shape. THE ROW (call it `CarriedLine`):

    key:        branded CarryKey — clusterUnitIds (sorted) ‖ premise, where
                premise = per-unit (unitId → destination cell) over the
                ply-1 assignment the line was rooted on. This is exactly
                threadKey (threads.ts:625-632) — already canonical, already
                order-free.
    rootTurn:   the turn the line was rooted at (tripwire, §1.1).
    line:       the proved continuation — per remaining ply, the cluster's
                joint move as (unitId → to) pairs (the scout's `lines` /
                per-ply `argmax`, scout.ts:271-282, threads.ts:294-304).
                Ids and cells only; NEVER Candidate objects (paths are
                root-relative and die with the root).
    value:      the deepest security value the line proved, in score units —
                `DeepObservation.value` (scout.ts:157-168).
    sigmaLedger: PER-PLY sigma components, NOT the folded sigmaSq. The scout
                already computes sigma per ply (`sigmaOfPly`,
                scout.ts:201-215) and folds by accumulation
                (scout.ts:258-267); the store keeps the per-ply terms so
                re-basing can POP the resolved ply (§3).
    plies:      turns of play the value spans.
    citedUnits: the thread's entanglement set (threads.ts:383-384) — the
                compatibility key (§2).
    concernRank: for enemy-side rows only — see below.

TWO VIEWS over the same store:

- **Productive-branch priorities** (owner: "they made the move we hoped"):
  rows keyed by OUR cluster's premise over the DETERMINED units. On match,
  `value`+popped sigma feed the new decision's belief; `line` (advanced one
  ply) becomes a seed for `Scout.extend` and for the cluster coordinator's
  proposal order.
- **Concern sets** (owner: "opponent commenced the dangerous trajectory"):
  rows derived from the min side — for each thread, the enemy replies its
  witnesses/ledger cited as achieving the floor, ranked by how much floor
  they cost (the banked `Witness` set the session already taps,
  team-decision-engine.ts:1433-1436, converted to (enemyUnitId, to) pairs +
  magnitude — the unary `EdgeKey` vocabulary, edge-ev.ts:263-266). On
  re-base these are read by candidate ordering for the ADVERSARY generator
  role and by ponder-target selection (§6). They are penalties-that-vanish
  by polarity (contract rule 21, edge-ev.ts:64-86): a stored concern may
  only demote our moves that walk into the concerning reply, never attract.

### 1.3 Where a carried row lands: a new ObservationKind

Fold into the belief channel as a new kind, `'carried-prior'`, beside the
declared-but-unpopulated `'shadow'` (belief.ts:96-98). It is deep-kind-like
(denominated at `plies > 1`, so NOT truncated into the new one-ply interval —
`foldObservation`'s horizon-conditional truncation, belief.ts:299-313, applies
unchanged) but gets its own provenance slot because the report's zeros are
load-bearing ("a zero in deep-finding says no deep finding reached this
branch", belief.ts:80-88) — a sweep must be able to tell carried influence
from fresh-depth influence without reading source. Precision is
`precisionOfSigma(residualSigma)` (belief.ts:164-168), residual per §3. The
precision-weighted merge (belief.ts:274-313) is already the right algebra and
needs no change; the kernel's rebuild-not-accumulate discipline
(belief.ts:266-272) must treat the carried prior like the deep half in
`refreshBelief` — folded once per rebuild, never re-accumulated.

The belief already DECIDES only among floor-undominated candidates
(`depthRung` sits above floor comparison but below the witness veto and
dominance, core.ts:1601-1615, 1645-1690), so a carried prior can reorder
overlapping intervals and can never override a proof — the advisory-only law
is inherited, not re-argued.

## 2. THE COMPATIBILITY MATCH (Q2)

### 2.1 What "compatible" means, from the thread's own structure

A thread's world at ply 1 factors into (a) ENUMERATED variables — the
cluster's own joint move, exact — and (b) HELD claims — everything else as
clouds (door.ts:13-28, shells 1 and 2). When reality arrives (the whole board
is world-readable each turn — dof-synthesis fog verdict; only the current
turn's staged moves are ever hidden):

- For a HELD unit, ANY realized move is compatible by construction: the cloud
  contained it (cloud soundness is standing-verified — ORCH's finding that
  unfreeze's claim-containment accepted every truth-fed catch-up; 48,127 cell
  memberships, zero escapes in the arena). Nothing to check, nothing to pay.
- For an ENUMERATED unit, compatibility is EXACT equality of (unitId,
  destination) between the premise and the realized move. Destination, not
  path: the premise stored destinations (threadKey uses `to`), and two paths
  to one destination that resolved differently produced different boards —
  which the next check catches anyway.
- For a unit whose realized move DIFFERS from the premise: the thread's own
  `citedUnits` set is the relevance oracle, exactly as it already is for
  catch-up invalidation ("every cached evaluation that cited the unit is now
  about a board that never existed", threads.ts:497-514). Rule:

      differs ∧ cited      → row INVALID (drop)
      differs ∧ not cited  → row COMPATIBLE, sigma widened by one
                             `interfere`-style term (§3): the unit never
                             touched the line's value, but the board it
                             stands on is not the premise board.

This is cluster-local matching with the near-miss case handled by the
thread's own ledger rather than by a similarity metric — no new "irrelevance"
judgment is invented; the one the invalidation machinery already trusts is
reused.

One more gate, free of charge: the row's `value` was proved on the RESOLVED
board of the premise ply. After matching the joint move, compare the row's
recorded post-resolution facts (deaths/severs of cited units — carry the
thread's `carriedContingent` and `severed` sets, door.ts:141-147) against the
real board's roster. A cited unit the thread priced alive that is really dead
(or vice versa) → INVALID. This catches the path-vs-destination residue and
any resolution the premise mispredicted.

### 2.2 Cost budget

Matching is: realized joint move extraction (already on the turn doc) + per
row: O(|premise|) integer equality + O(|diff| × set lookup). Store ≤ 64 rows
(§7) × ≤ `maxVariables`(4) premise entries + cited-set lookups → thousands of
integer ops, well under 0.1 ms. Budget it at ≤ 1 ms hard, i.e. ~0.01% of the
9,850 ms production budget and still ≤ 0.2% of a 500 ms arena budget — two
orders of magnitude under the 337 ms first-plan enumeration toll the
batch-2 analysis is already fixing. Anything richer (board hashing,
transposition detection across histories) is out: clouds make board hashes
weak, and the payoff class it would add (same board reached by a different
move order) is rare on trail-bearing boards where bodies remember history.

### 2.3 What is deliberately NOT matched

No fuzzy matching on "the opponent moved one cell off the explored line". A
near-miss on a CITED unit changed the adjudication the value rode on; calling
it compatible would transfer a number about a board that never existed —
the exact bug class invalidateCitingUnit exists for. The near-miss's real
value is captured differently: the CONCERN rows for that enemy unit still
match (they are keyed (unitId, to) per reply, not per full joint move), so
attention transfers even where the value must not. That split — values
transfer on exact-cited match, attention transfers on per-unit match — is the
design's answer to "how do near-misses help".

## 3. EXPLORATION-VALUE COLLAPSE (Q3)

The branch-interest currency is already split in the code, and the split is
the answer:

- EXPLOITATION value = the posterior mean `mu` (belief.ts:192-219) and the
  deep `value`.
- EXPLORATION value = interval width / precision (`precisionOfInterval`,
  belief.ts:232-237) plus the scheduler's `advisoryRate` = spread ×
  instability (threads.ts:316-329). Owner ruling 12 requires the
  exploration drive explicit; it lives in these two places and nowhere else.

### 3.1 The rule

**Transfer the exploitation half as a value prior; NEVER transfer the
exploration half. Exploration value is recomputed at the new root from the
new posterior's own width.** Concretely:

1. A carried row contributes exactly one observation: (value,
   residualSigma, plies−1). It contributes NO visits, NO precision beyond
   what residualSigma earns, NO spread, and never touches `advisoryRate` —
   the new decision's own spreads regenerate exploration value from live
   measurement.
2. residualSigma is the sigma ledger with the RESOLVED ply POPPED. The
   per-ply terms (`world`, `ourMiss`, `theirMiss`, `fog`, `interfere` —
   sigmaOfPly, scout.ts:201-215) of ply 1 measured exactly the uncertainty
   reality has now resolved; on a compatible match those terms are gone and
   the remaining ledger (plies 2..k) is the honest residual. This is why the
   store keeps the ledger per ply (§1.2) instead of the folded sigmaSq: the
   fold is irreversible and popping is the whole re-base.
3. `plies` decrements by one per re-base (the value now spans one turn less
   of the future). **When plies′ ≤ 1, the row is DROPPED**: a one-ply-deep
   statement about the new board says nothing the new bank's own price will
   not prove better within the first slices, and folding it would only
   anchor `mu` on stale arithmetic.

### 3.2 Why the collapse is then automatic

A branch whose interest WAS its uncertainty had, by definition, low precision
and high spread. Under rule 1 its carried contribution is a wide-sigma
observation ≈ information-free (`precisionOfSigma` of a big sigma ≈ 0,
belief.ts:164-168: "a reading that positions a mean and claims nothing... and
earns none") — it neither attracts compute nor orders candidates. Reality
resolving the uncertainty does not need a special "collapse" step; refusing
to transfer precision-as-attention IS the collapse. Conversely a branch whose
interest was a clean proved continuation (small per-ply sigmas) carries at
near-full strength — which is the owner's "they made the move we hoped"
case, landing exactly as intended.

The one place uncertainty-driven interest legitimately transfers is the
CONCERN view (§1.2): "we never resolved whether this reply kills us" is a
reason to spend the NEW decision's compute there. That transfers as an
ordering/targeting row (which reply to enumerate/ponder first), never as a
value — the two-currency law (threads.ts:316-333: advisory spread and sound
witness yield "never a sum") extended across the turn boundary.

## 4. STALENESS / FEINT GUARD (Q4)

### 4.1 Decay schedule — truncation, not decay

L4 ("degradation is truncation, not decay", door.ts:296-307) governs here
too. There is no exponential fade constant to tune:

- Per re-base: pop a ply (sigma ledger shrinks, plies decrements) — the
  precision the row can earn falls as its own measured residual, not as a
  chosen rate.
- Hard horizon: rows die at plies′ ≤ 1 (§3.1). With `depthMax` 3
  (schedule.ts:168-181) a row survives at most 2 re-bases; deeper future
  configs extend survival exactly as far as their lines actually saw. The
  store cannot accumulate a long tail of ancient hypotheses BY CONSTRUCTION.
- Per incompatible event: exact-match failure on a cited unit is death, not
  discount (§2.1) — the blunt rule `ThreadLedger.onEpochChange` chose for
  the same problem ("Safest v1, and it is deliberately the blunt one",
  threads.ts:479-495), with the same follow-up: measure what the bluntness
  costs before building speculative survival.

### 4.2 Breadth-reserve interaction

Retained attention spends INSIDE the existing rations, never beside them:

- Carried seeds enter through `Scout.extend`/`run` seeds and the cluster
  proposal cursor — all purse-bounded. The scout's `reserve` (default 0.5,
  schedule.ts:103-121, 185-188: `effectiveTithe = min(tithe, 1 − reserve)`)
  already guarantees at least half the decision to the fresh ply-1 search
  REGARDLESS of what the priors say. That floor is the structural anti-feint
  budget: a fully poisoned store can misdirect at most the tithe, for at
  most one turn per row generation.
- Carried concern rows reorder the adversary/candidate ordering channel —
  ordering only, set-membership never ("a probability may choose the ORDER
  of anything; never the SET a floor closes over", edge-ev.ts:39-45).
- Owner ruling 41's focus-narrowing search ("greater depth, lower breadth,
  triggered by acute-impact situations; breadth reserve against feints")
  should be implemented as a POSTURE-like modulation of (tithe, depthMax,
  proposal cursor breadth) — and the carried store is precisely the trigger
  evidence ("acute" = a carried concern row matched reality). The reserve
  stays a floor in every posture; the dial moves tithe and depth between
  floor and ceiling.

### 4.3 The anti-feint argument, stated

A feint is an opponent move optimized against our RETAINED attention: either
(a) commence a threatening line to fix our compute, then switch, or (b) play
outside our concern set. Against (b): the fresh search's sound machinery
(rung-0 fatality, floors, dominance) is untouched by the store — staged-move
safety never depends on carried rows, so the harm ceiling is wasted tithe.
Against (a): the switch itself is a realized move that mismatches the
premise on a cited unit → the rows funding that attention die the same turn
(§4.1). The residual exposure is one turn of concentrated depth on the
feint's line — bounded by `effectiveTithe`, and PAID FOR by the symmetric
gain on every honest continuation. Worst-case-only opponent modeling
(ruling 13) also caps the feint surface: our concern sets are derived from
proved floor damage, not from behavioral prediction, so an opponent cannot
teach us a false model of their tendencies — there is no model to teach.
The one behavioral knob that exists, dodge-discount cover counting
(ruling 23), reads only the CURRENT board's geometry, never history — feint-
immune by construction.

One explicit non-goal: carried rows must never make the incumbent sticky
across turns. The `StickyStager`'s dethroning discipline is per-decision;
the new decision's first incumbent comes from conform/seed as today, and
carried rows speak only through belief/ordering once floors exist.

## 5. MIXED-FIDELITY PATHS (Q5)

The worry: interior nodes of a retained line were priced with ply-1 units as
clouds; after re-base the ply-1 world is exact. Does the epoch/pending
machinery make mixing sound, or does the line need re-folding?

### 5.1 What the epoch machinery actually licenses

Its precedent is precisely "values never cross the boundary; identity,
incumbency and attention do" (§0). It does NOT license splicing old interior
valuations under a refined root — `run.plans.clear()` is unconditional. And
the thread layer's posture-flip handler makes the same call one level down:
keep the entry, CLEAR THE PLIES, re-price from what is cached
(threads.ts:517-541 — "the resolutions are still resolutions" but the folds
are owed again).

### 5.2 The cheapest sound treatment: re-root and re-walk, never splice

So the answer to "does the whole line need re-folding?" is: the whole line
needs RE-WALKING, and that is cheap, and it is what the owner's own words
mandate ("actual simulation runs RESTART"):

1. The carried `line` (plies 2..k joint moves) becomes the FIRST seed of the
   new decision's thread on the matching cluster: open the thread at the
   real root, `deepen` along the stored line before exploring alternatives.
   Every ply is re-priced by the same door/evaluator at the new root's
   fidelity — no mixed-fidelity node ever exists, because no old node is
   reused as a node.
2. Re-walking is cheap for exactly the reason the door documents: held
   units' clouds advance by absolute-turn query and saturated clouds cost
   zero further steps ("deep plies are CHEAPER per ply for the most distant
   units", door.ts:296-307); the timeline/shell interning
   (threads.ts:23-39, cost refusals 1-3) makes the per-ply contact test a
   word-AND. The expensive part of depth was DISCOVERING the line;
   re-pricing a known line is the cheap fraction of it.
3. The carried scalar (§1.2) exists so the branch is ordered correctly
   BEFORE the re-walk completes — it is the bridge over the first slices,
   after which the fresh deep observation supersedes it through the normal
   rebuild (`refreshBelief` replaces the near half and re-folds the deep
   half; the carried prior is dropped from the fold the moment a fresh
   deep-finding for the same branch exists — same-line evidence must not be
   double-counted as two independent observations).

The interior-node question thus dissolves rather than being solved: interior
nodes are never transferred, so no soundness argument about them is owed.
What IS owed — and cheap — is the drop-on-fresh-evidence rule in 3, without
which the same line's old and new readings would compound precision
(exactly the repeat-fold bug belief.ts:266-272 already guards inside a
decision).

### 5.3 The advisory ceiling caveat, carried forward

Threads' ceilings are optimistic where I7/I8 aren't carried (distrusted
units priced alive, door.ts:86-99) and where the engine's mover-blind
`deathPossible` widening applies (engine feedback ledger). Both are already
confined to the advisory channel; the transfer store inherits the
confinement because its only outlet is the belief/ordering channel (§1.1).
No new exposure — but the store must carry the thread's `distrusted` count
into the sigma ledger's `interfere` term so a line built on distrusted
claims transfers weak, not just labeled.

## 6. PONDER UNIFICATION (Q6)

### 6.1 The inter-turn window IS a partial board — confirmed, with one gap

Between our commit and the server's resolution, the true state is: our joint
move known (committed on the wire), every rival's staged move hidden (the
one genuinely hidden thing in production — firestore rules 261-263 per the
deployment report; everything else world-readable). The existing machinery
expresses exactly this with zero new simulation concepts:

- OUR units: modelled, with the plan FIXED — the reference-action mechanism
  (`basisOf`/`referenceActionsFrom`, src/lobster/search/basis.ts:40-114)
  already fixes units "not ours to command" to declared intents; a committed
  own-unit is the same shape with us as the declarer.
- THEIR units: held at observed positions, `heldAtTurn = currentTurn` —
  `fieldHolding`/`withHeldMany`/`advanceTo` (src/lobster/
  substrate.ts:1066-1067, 1329-1359) is the cloud-advance machinery, and it
  is the SAME code the door uses to advance held units in imagination
  (door.ts:296-307). The owner's unification claim is therefore literally
  true at the code level: `continueFrom` on a `Resolution` of (our committed
  plan × a chosen enemy reply) yields an n+1 root; `Scout.extend` deepens
  from it; findings publish as `DeepObservation`s; the transfer store (§1)
  is how they reach the next decide(). Ponder = a scout session whose seeds
  are (committed plan × reply hypotheses), run between turns, whose ENTIRE
  product is transfer-store rows. No new pricing, folding, or thread
  concept.
- The one genuinely new piece is LIFECYCLE, not simulation: a ponder session
  object on `GameState_` (the sanctioned seam, §0), opened when the final
  flush commits, closed/harvested when the next turn's board arrives, its
  purse denominated in resolution-equivalents like the scout's
  (schedule.ts:143-165 — no clock reads inside; §8 for why this matters
  doubly here).

### 6.2 What ruling 13 (worst-case-only) means for ponder targets

No likelihood model over enemy replies may exist. The reply hypotheses that
get ponder compute are therefore, in order:

1. THE FLOOR-JUSTIFYING REPLIES: the witnesses the decision just banked —
   the replies proved to achieve our staged plan's worst case
   (tapWitnesses, team-decision-engine.ts:1433-1436). Under worst-case
   semantics these are the "predicted board": the world our own floor is
   already denominated in. Pondering them deepens the exact line our
   guarantee rides on — if the worst case happens we have the continuation
   pre-ranked; if not, the compatibility match discards cheaply.
2. THE CONCERN SET (§1.2): remaining witnesses/ledger-cited replies by floor
   damage — worst-case-derived, so ruling-13-clean.
3. Where 1-2 underfill the window: replies ranked by ruling 23's
   dodge-discount cover counting — the ONE sanctioned probability-shaped
   weighting (uniform prior over OUR vulnerable unit's moves, enemy
   best-responding to the uniform; d(m)=Σ_{r∋m}|C(r)|/Σ|C| per
   $SP/dodge-discount-design.md). It reads current-board geometry only.

Never: a "most likely move" model, frequency statistics over the opponent's
past moves, or anything the deferred D2 socket would hold. When the owner
later populates D2 with real prediction, ponder target selection is the
FIRST consumer that should switch — the socket boundary is precisely here.

Ruling 13's other consequence is reassuring: since ponder output is
advisory-only rows and the sound channel restarts fresh each turn, the
worst-case-only constraint is structurally impossible to violate through
ponder — no ponder product can move a floor.

## 7. MEMORY BOUNDS

- The store is a fixed-capacity LRU on `GameState_`, capacity = ThreadLedger
  capacity (64) rows for the value view + 128 concern rows; eviction order:
  lowest residual precision first, then LRU (a value decision before a
  memory decision, inverting deliberately the thread ledger's "live never
  evicted ahead of parked" because here nothing is live — everything is a
  prior).
- A row is plain numbers and ids: key string (~40B), ≤ depthMax×maxVariables
  (unitId,to) pairs, ≤ depthMax sigma quintuples, 4 scalars, 2 small id
  sets → < 1 KB/row, < 200 KB/game worst case against the 512 MB heap.
- NO SLABS, NO TIMELINES, NO FrozenRecords, NO Candidate objects, NO
  ScoreBounds — the V3 leak class (CloudSource.timelines strong-Map leak,
  +33 MB/100 turns) and the scout's own slab discipline ("a data object
  that owns an arena slab is a leak waiting for someone to forget it",
  scout.ts:249-251) both say the same thing: the store holds nothing with a
  lifecycle. The plies′ ≤ 1 rule (§3.1) additionally self-drains rows in ≤
  depthMax−1 turns, so even an eviction bug cannot accumulate a season of
  hypotheses.

## 8. DETERMINISM / REPLAY under event-driven timing

Two new determinism inputs appear; both must be tamed:

1. THE STORE ITSELF is an input to decision N+1. It must be a pure function
   of (decision N's search products, realized turn N board) — which it is,
   IF the harvest point is fixed: rows are written exactly once, at
   decision end (final flush) and at ponder close, never mid-slice; the
   compatibility match runs exactly once, at decision open, before any
   slice. (Same discipline as pin events: taken between slices, never
   inside one, kernel.ts:1228-1230.) Decision N's products are themselves
   slice-count-dependent (wall clock), so cross-decision replay
   additionally requires the store SNAPSHOT stamped into the decision's
   MechanismReport/BotStamp — small (§7), and it makes any single decision
   replayable by injection without replaying the whole game. This is the
   same honesty mechanism as `seatConfigs` in the manifest: record the
   input, don't pretend it's derivable.
2. PONDER EXTENT is adversary-controlled wall clock (opponents commit when
   they please; a fast opponent starves the window). The purse discipline
   handles the inside (no clock reads → the ply sequence is a pure function
   of the seeds and the allowance); the ALLOWANCE is the problem. Ship the
   deterministic option as default: a fixed resolution-equivalent allowance
   per window (spend it or be cut off by the turn's arrival; if cut off,
   harvest whatever whole plies completed — plies are atomic, a torn ply is
   discarded). The spend-all-idle-time variant is a config field on
   BotConfig, honestly labeled non-replayable-without-snapshot. See
   DILEMMA 5 — this is a real trade, not a detail.
3. Seeding: ponder and carry-order draw from the per-game `matchSeed`
   stream (GameState_:433-443), namespaced by (turn, 'ponder'|'carry') so
   the inter-turn work cannot perturb the intra-turn draw sequence.

## 9. BUILD SHAPE (two-lane compliant, ruling 24)

Architecture (lane b, own feature branch, validated as a batch arm before
merge): the store type + GameState_ field, the harvest/match points, the
`'carried-prior'` ObservationKind, the ponder session lifecycle. Joint
collections (lane a, normal commits): concern-row ordering entry (a
candidates.ts comparator slot beside `potionOrdering`), ponder target
policies (worst-case-witness / +dodge-cover) as selectable members.
Acceptance test per ruling 35, AS A GAME: a seeded two-turn scenario where
the opponent commences the explored dangerous line — the carrying bot stages
the refutation at N+1 within the first slices while the bare bot needs the
full budget to rediscover it; and the twin scenario where the opponent
deviates off-line — both bots stage identically (the store visibly declined
to speak). depthEffectRate's sibling metric: carryEffectRate = % of
decisions where a carried row survived the match AND changed slice-1
ordering or the staged move; plus carryUtilization (rows matched / rows
stored) to watch DILEMMA 2.

---

# DILEMMAS — the hard trades, stated plainly

**DILEMMA 1 — The cross-basis refusal the owner is counting on does not
exist across turns; safety must be re-manufactured, and only by convention.**
The bank's refusal machinery compares assumption sets that contain no board
or turn identity (score.ts:58-69); the eval memo documents that its key
"cannot express two substrates that are not the same board"
(evalmemo.ts:66-70). Today's cross-turn safety is entirely LIFETIME safety —
everything dies with the decision — and the transfer store is precisely a
decision to breach that lifetime. The trade forced: either stamp board/turn
identity into the basis vocabulary (touching the hottest strings in the
system — basis keys are computed per branch per price — and churning every
bound for a guarantee only the new store needs), or guard purely by TYPE and
lint (carried rows structurally cannot be Bounds) and accept that the algebra
itself will never again catch a determined future refactor smuggling an old
floor forward. I recommend the second with the rootTurn tripwire, but it
must be said out loud: this is the first value-bearing object in the system
whose soundness is enforced by convention rather than by the refusal
algebra.

**DILEMMA 2 — Honest exploration-collapse makes the mechanism look like it
isn't working.** The owner wants "interestingness" to transfer; but for the
large class of branches whose interest WAS unresolved uncertainty, reality
resolving it means the honest carried precision is ≈ zero and the honest
behavior is silence. Add the exact-match compatibility gate and the
plies′ ≤ 1 drop rule, and most turns the store will transfer little or
nothing — low carryUtilization BY DESIGN, with the payoff concentrated in
the occasional turn where a deep proved line survives contact with reality.
The trade forced: transfer more aggressively (carry spread/attention as
attention, fuzzy-match near-misses) and concentrate compute on yesterday's
already-answered questions — or transfer honestly and accept a headline
utilization number the owner may read as the mechanism failing when it is
the mechanism refusing to lie. The metric split in §9 (carryEffectRate vs
carryUtilization) exists so this argument can be had over numbers.

**DILEMMA 3 — Under ruling 13, the concern set is our worst-case's shadow,
not the opponent's mind — and pondering it feeds the passivity pathology.**
Concern rows are derived from witnesses: the replies that damage OUR floor.
Worst-case-only means we concentrate inter-turn compute on threats in
proportion to how much they'd hurt, with zero regard for whether this
opponent would ever play them — the exact structural bias behind the
4×-confirmed passivity caveat, now given a second budget to spend. The
dodge-discount (ruling 23) relaxes only our side (uniform over OUR moves;
the enemy still best-responds pessimistically). The trade forced:
ruling-13-compliant ponder buys real depth on mostly-unplayed threats and
systematically underfunds the opponent's actually-tempting greedy
continuations — and nothing inside the sanctioned model can fix that;
better targeting is exactly the D2 opponent-model socket the owner has
deferred. Ponder makes the cost of that deferral recurring rather than
one-off.

**DILEMMA 4 — Almost none of the computed VALUE survives re-basing; what
transfers is attention, and the owner should not expect otherwise.** "Pause
at the leaves and advance the held state" suggests the explored tree's
numbers carry over. They cannot: every interior valuation is
premise-conditional (clouds, advisory ceilings, I7/I8 residue), and the
epoch precedent plus the posture-flip precedent both land on values-never-
cross. The sound treatment (§5.2) keeps one scalar + sigma ledger per line
and RE-WALKS the line at the new root — so the conserved quantity is which
lines to price first, not the pricing. The trade forced: any design that
conserves more (splicing subtrees, caching interior bounds against a board
hash) buys real compute savings at the price of mixed-fidelity nodes whose
unsoundness the refusal algebra cannot see (DILEMMA 1 compounding); the
honest design re-pays most of the simulation cost every turn and banks only
the search-guidance. If the owner's mental model is "keep the tree", the
delivered mechanism is "keep the map of the tree" — cheaper than it sounds
(saturated clouds re-dilate for free, known lines re-price at a fraction of
discovery cost), but the expectation gap is real and worth surfacing before
he measures it.

**DILEMMA 5 — Ponder strength and determinism are directly opposed, and the
opponent holds the knob.** The inter-turn window's length is set by when
opponents commit — adversary-controlled wall clock. Spend-all-idle-time
ponder maximizes strength but makes our turn-N+1 move a function of the
opponent's turn-N thinking time: non-replayable without snapshot injection,
non-reproducible in paired sweeps (the harness's twin arms would ponder
different amounts), and a genuine information channel (an opponent who
commits instantly starves our ponder; one who reads our clock dependence
could exploit it). A fixed resolution-equivalent allowance is deterministic
and sweep-comparable but wastes most of the window against slow opponents —
the common case in Centaur play, where the whole point is that humans think.
The trade cannot be dissolved, only priced: ship deterministic-allowance as
default for validation runs, spend-all as a config for live play, and stamp
the store snapshot into telemetry so live games remain post-hoc explainable.
The harness cannot validate the configuration we most want to run live.

---

# STRONGEST DESIGN COMMITMENT

The transferred object is a **per-line scalar prior with a per-ply sigma
ledger** — key = the thread's own canonical (cluster ids ‖ per-unit
destination premise) from threadKey; payload = deepest proved security
value, per-ply sigmaOfPly components, plies, citedUnits — living in a
fixed-capacity store on GameState_, matched at decision-open by exact
equality on cited enumerated units (held units compatible by cloud
soundness), folded into the new decision's belief as a new `'carried-prior'`
ObservationKind at the precision earned by the ledger WITH THE RESOLVED PLY
POPPED, dropped at plies ≤ 1 or on any cited mismatch, superseded the moment
a fresh deep finding exists for the same branch, and structurally incapable
of being a Bound. Everything else — ponder, concern ordering, focus
narrowing — is a producer or consumer of that one row shape.
