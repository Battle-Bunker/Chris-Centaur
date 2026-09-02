# The Observation API — fog as a wire parameter

Companion to `00-THE-OBJECT.md` §7. Grounded against the real wire
(`shared/types/Game.ts::Turn`, verified 2026-09-01), the vendored cloud engine
(`partial-engine/cloud.ts`: `Cloud`, `CloudPremise`, `CloudTimeline`,
first-move narrowing), and the substrate's existing `observedTurns` plumbing.

---

## 1. What the wire is today, and why fog cannot be bolted on read rules

The `Turn` document carries, world-readable: `playerPieces` (full occupancy),
`moves` (where every unit ended), `paths` (piece traversals), `orientation`,
`deaths`, `clashes`, `severedCells`, `food`, `hazards`,
`invulnerabilityPotions`, `playerInvulnerabilityLevel`, `activeEffects`
(with `expiryTurn` and `sourcePlayerID`). One document, one truth, everyone
reads it.

Firestore rules cannot mask FIELDS per reader, so per-observer fog cannot be a
read rule on this document. The engine already has the pattern that works:
`privateMoves` is per-owner readable (`firestore.rules:261-263`). Fog
generalizes that precedent:

    games/{gameId}/turns/{n}            — the full record (server/replay/admin)
    games/{gameId}/turns/{n}/views/{teamId}   — the OBSERVATION each team gets

The processor writes each view at resolution time by applying the game's
visibility rule to the full record. A game with no visibility rule writes no
views and everyone reads the full record — today's game is the degenerate
case, bit for bit.

## 2. The ObservationRecord

What one team receives for one turn. Three parts, each a bundle of evidence:

```ts
interface ObservationRecord {
  /** The Turn fields, masked. Same schema as Turn — a masked unit simply
   *  drops out of playerPieces/moves/orientation/paths/unitTypes exactly the
   *  way a DEAD unit already drops out of `orientation`. Consumers already
   *  handle absence. */
  facts: MaskedTurn

  /** WHAT COULD NOT BE SEEN — the mask, declared. Without this, absence is
   *  uninterpretable (dead? invisible? never existed?). */
  mask: {
    /** Units withheld from `facts` this turn, with the last turn this
     *  observer saw them. This line IS a FrozenRecord constructor. */
    hiddenUnits: Array<{ unitId: string; lastSeenTurn: number }>
    /** Which evidence channels the rule redacts for hidden units (see §4).
     *  Declared per game, echoed per turn so a replay is self-describing. */
    redaction: RedactionPolicy
  }

  /** Resolution events, each independently maskable, each evidence:
   *  deaths, clashes, severedCells, food delta, potion pickups/expiries.
   *  Already ON the wire today as Turn fields — the reframe is that under a
   *  mask each event carries an ATTRIBUTION that may be partial:
   *  a clash whose winner is hidden reports the loser and the cell but not
   *  the winner's id, per the redaction policy. */
  events: MaskedEvents
}
```

Design commitments:

1. **The mask is data, not convention.** `hiddenUnits` makes "unit u is
   invisible since turn k" a public fact even while u's position is hidden —
   which matches the game: the potion pickup is visible the turn it happens
   (`activeEffects` today), so WHO went invisible and WHEN is common
   knowledge; WHERE they went is not. The bot's ingestion maps each
   `hiddenUnits` row straight onto a `FrozenRecord` with
   `heldAtTurn = lastSeenTurn` — the exact constructor the cloud engine
   already takes, with `PartialEngine.hold`'s `heldAtTurn` override built for
   exactly this ("consumer staleness = currentTurn − observedTurn").
2. **Own team is never masked to itself.** The view for team T always carries
   T's own units whole (the `privateMoves` precedent). Asymmetry is the point
   of invisibility.
3. **The full record still exists.** Replays, scoring, and the resolver read
   turns/{n}; only live observers read views. Nothing about adjudication
   changes — fog is an OBSERVATION rule, never a resolution rule.

## 3. Per-unit masks subsume per-cell masks (the mask algebra question)

Visibility is per-(observer, unit, attribute), NOT per-cell. Two reasons:

- An invisibility potion hides a UNIT; the cells it stands on look empty to
  the observer even under perfect "cell vision". A per-cell model cannot say
  that without lying about the cell.
- A hypothetical vision-radius rule IS expressible per-unit: "unit u's
  attributes are masked for observer O this turn iff every cell of u lies
  outside O's lit region" — the mask rule reads cells, the mask ITSELF is
  still a set of (unit, attribute) withholdings plus (for negative
  information) the lit region published in `mask`. So per-unit masking with
  an optional `litCells` field covers both families; committing to it
  forecloses nothing. (Resolves 00-doc open question 3.)

The `attribute` axis matters for cheap rules: a rule may hide position but
publish health ("you hear it breathing"), or hide everything but existence.
`RedactionPolicy` enumerates the channels; the conditioning ladder (§4) is
written against channels, so a new rule composes existing conditioners.

## 4. Bot-side conditioning: the three-rung ladder

Ingestion becomes `S_{t+1} = condition(dilate(S_t), obs_t)`. Dilation is the
cloud engine, untouched. Conditioning has a cost/precision ladder, every rung
sound (only removes worlds the evidence refutes), every rung OPTIONAL
(skipping a rung only leaves S wider — the over-approximation covenant means
conditioning is pure upside, droppable under pressure):

**C0 — free, always on.**
- End-of-turn visible occupancy is exclusive: cells shown occupied in `facts`
  cannot also hold the hidden unit at end of turn → one `bbAndNot` against
  the visible occupancy board, on `possible`/`headPossible`.
- Explicit partial attributions in `events` (a clash at cell c against a
  hidden contestant → head-front collapses to c at that turn; a death row for
  the hidden unit → the cloud is a corpse).
- `food`/`invulnerabilityPotions` boards are published: the premise's
  freeze-turn item masks stay exact instead of merely sound.

**C1 — cheap inference, on by default.**
- FOOD-VANISH: a food cell present at t, absent at t+1, with no visible eater
  ending there → the hidden unit's head was there → head-front collapses to a
  point, better than a fresh observation (it also implies +health, priced by
  the existing two-phase food relaxation).
- SEVER GEOMETRY: `severedCells` on a visible snake with no visible severer →
  the hidden unit crossed those cells that turn AND severs require strictly
  higher tier → a position constraint and a TIER FLOOR in one event. (Tier
  floors are new to `StrengthBounds` consumers only in direction — the bounds
  object already carries endpoint pairs.)
- POTION-VANISH: same as food-vanish on the potion board; additionally starts
  the ±1 tier bookkeeping the cloud's `couldCollectPotion` machinery already
  models speculatively — the event turns "could have collected" into "did".

**C2 — expensive, scheduler-priced.**
- NON-EVENT EXCLUSION: a visible mover that traversed cells and SURVIVED
  proves it met no hidden body it would have lost to along the way. Sound
  only at sub-step resolution (the hidden unit also moved during the turn; a
  cell can be crossed by both at different sub-steps without any contest), so
  this rung runs the risk layer's sub-step arithmetic in reverse
  (`headSubStepLBOf` gives the hidden unit's earliest arrival per cell; a
  survivor's traversal at sub-steps the hidden unit could have occupied the
  cell excludes the overlap worlds). This is real compute for real narrowing
  in corridor fights; it is exactly the kind of purchasable width the
  scheduler's VOI should price, which is why the reducibility tag (00-doc §5)
  marks observation-fog width as "partially purchasable: C2 pending".

Non-goal, named: probabilistic conditioning ("the hidden unit PROBABLY went
toward food") is a WEIGHT update, not a support update — it belongs to the D2
weight supplier over hidden-state coordinates and never touches S. The ladder
above is all set arithmetic.

## 5. The ConditioningTrace — keeping the timeline pure

The cloud engine's load-bearing property: a `CloudTimeline` is a pure function
of `(FrozenRecord, CloudPremise, narrowing)`, computed once, shared by pointer
across the whole search tree. Naive cross-turn conditioning breaks it — the
belief after two turns of evidence is no longer any function of the freeze
record alone.

The repair is the same move the engine already made for first-move narrowing
(prefix closure): make the evidence part of the cache key.

```ts
interface ConditioningTrace {
  /** Per absolute turn: the admissible-set masks C0/C1/C2 produced.
   *  Monotone-droppable: removing an entry only WIDENS the timeline. */
  entries: ReadonlyArray<{ turn: number; headMask?: Board; bodyMask?: Board;
                           tierFloor?: number; healthDelta?: number }>
  /** Content hash — extends frozenRecordKey for the timeline cache. */
  key: string
}
```

Timeline computation threads the masks: `front_{k+1} = dilate(front_k ∩
mask_k)`. Still pure in `(record, premise, trace)`; still cached
(`frozenRecordKey ⊕ trace.key`); still shared by pointer. And the trace's
droppability is the memory-pressure valve: a unit hidden for 40 turns does not
carry 40 masks — old entries compact into the current front (the dilation of
a conditioned front IS the summary of everything before it), so the trace a
live bot holds is O(1): the last conditioned front plus this turn's evidence.
The array form exists for replay/audit, not for the hot path.

First-move narrowing then stops being special: it is a one-entry trace whose
mask came from an ASSUMPTION rather than an observation — which is precisely
why it must ride the basis (`ClaimBasis: "narrowed"`) while observation
entries must NOT (evidence is unconditional). One mechanism, two provenance
tags, and the existing basis-refusal law already polices the difference.

### 5b. Disjunctive support — the box-union upgrade (second pass, 06-doc §4)

A single cloud is a BOX: per-coordinate sets (position board × health
interval × tier endpoints × kindSet) whose cross-product over-approximates
the true joint. Boxes lose correlations: after a turn where food vanished at
A *or* B with no visible eater, the truth is "head at A with health h_A, or
head at B with health h_B", and one box must widen to {A,B} × [min h, max h]
— pricing worlds that cannot exist ("at A but hungry"). The box-particle-
filter literature (fetched: Gning et al., IEEE SPM 2013) says the fix is a
small UNION of boxes, and the (S, w) laws admit it without amendment:

- **Spawn**: only a C1/C2 disjunctive deduction may split a box (evidence
  with k explanations → k child boxes, each conditioned on its explanation).
  Compute never spawns; assumptions never spawn (they narrow, on the basis).
- **Never drop**: deleting a box is particle deprivation — the support stops
  covering the truth and every floor built on it is unsound. The only
  permitted forgetting is **hull-merge**: replace two boxes by their
  per-coordinate union hull. Sound (superset), monotone-lossy, and its limit
  is today's single cloud — graceful degradation built in.
- **Budget**: a per-unit box cap (2–4) with hull-merge on overflow, merging
  the pair whose hull inflates least (minimal added volume). The cap is a
  compute knob, not a soundness knob.
- **Consumption, zero-touch**: existing consumers (risk layer, bounds,
  postures) read the HULL — bit-for-bit today's behavior. New consumers that
  declare box-awareness (the mixture dodge, exposure pricing, C2) iterate
  boxes and fold soundly (worst over boxes for floors; weight-per-box for
  advised readings — the box weights are the advised channel's, supplied by
  the D2 socket like any other weight over S-coordinates).
- **Timeline purity holds**: a box is (record, premise, trace); a union is a
  small set of traces sharing one record. The cache key extends per box; the
  hot path holds the current fronts, O(boxes).
- **Scenarios span units; contradictions unwind** (second pass, 03-doc §8):
  a hypothesis branch is a JOINT scenario over the hidden-unit set (per-unit
  clouds are its marginals; hulls keep old consumers zero-touch), and a
  conditioning step that would empty S triggers the contradiction rule —
  unwind the weakest evidence class first (C2, then C1, never C0), rebuild,
  log, count. An empty support is a mis-attribution alarm, not a theorem.

### 5c. The store is a CSP, and minesweeper is its solved special case (fourth pass, librarian M36)

Not an analogy — an identification, and it retro-types the ladder: C0's
visible-occupancy exclusions and item-board differences are CARDINALITY
constraints; C1's multi-explanation deductions are DISJUNCTIONS; C2's
non-event exclusions are NEGATIVE JOINT constraints. The constraint store
(§5b's adoption, now with its literature) is exactly the shape the
minesweeper-inference line converged on: keep the constraints, PARTITION
THEM INTO COUPLED SUBSETS by shared variables — constraints sharing no
hidden-state variables decompose EXACTLY, which is the tractability move —
and serve marginals as the query surface. The coupled-subset partition is
the store's native index (each C-entry lists the unit-coordinates it
touches — the same citation pattern as everything else), and compilation
into scenario boxes (§5b's bounded view) happens per coupled subset, never
across them.

**M37, stated as a law rider before anyone crosses the regimes:** the word
"decomposition" now appears in two places with OPPOSITE soundness
characters. Decomposing the INFERENCE into coupled constraint subsets is
EXACT — no shared variables, no lost worlds, a theorem. Decomposing the
GAME by geometric proximity (cluster partition, R-5's finding) is an
APPROXIMATION whose error is un-modeled interference. A future builder who
reuses the game's cluster partition as the store's coupled-subset partition
(or vice versa) has silently crossed an exact decomposition with a lossy
one; the two partitions share code shapes and must never share an
authority. The store's partition is BY SHARED VARIABLES ONLY. (And on the
game side, d12's sharpening — folded via 16-doc §4: once positions are
sets, geometry is not even a well-defined cut; the boundary that survives
fog is the PUBLIC state, and the game partition's premise must record the
conditioning depth of the hulls it read.)

## 6. The mirror: Belief is observer-indexed, and invisibility's payoff needs the enemy's S

Everything above is Belief(us). The same object, parameterized by observer,
is Belief(enemy-team-E): what E can prove about OUR hidden unit, computable
from the view WE know E received (views are per-team but the RULE is public,
so we can reconstruct E's mask exactly, and E's C0/C1 evidence is a subset of
the full record we... do not have either — but our own unit's true state we
do, so we can run E's conditioning ladder on the true trajectory).

This is not speculative machinery; it is the value function of invisibility.
The worth of our invisible unit's next move includes how much of E's support
it preserves or collapses (stepping on food TELLS E where we are — C1 cuts
both ways). A bot that prices "their cloud about us" plays invisibility;
a bot that only prices its own board does not. In the factorization this
costs one construction: `Belief(observer)` as the constructor, `observer=us`
as today's only call site, and a D1 term family ("their support width over
our hidden units") that becomes available the day fog ships. No second
epistemics stack — the reuse IS the test that the object was carved right.

Second-order weights (what E BELIEVES we'll do, beyond what E can prove) stay
out: ruling 13 confines us to worst case FOR US, and the humans own empathy.
The socket shape (§00-4) admits them later without a rewrite.

## 7. Migration map (what changes where, honestly)

| Layer | Change | Size |
|---|---|---|
| TacticToes processor | write per-team views under the visibility rule; rules for views/{teamId} | new module, precedented by privateMoves |
| TacticToes rules/config | `visibility` block in game setup; redaction policy | small |
| Wire types | ObservationRecord (= Turn + mask + partial attributions) | additive |
| Bot ingestion | read the view, not the turn; build FrozenRecords from mask.hiddenUnits; feed real `observedTurns` (already plumbed: substrate.ts:232, workers, laws) | moderate |
| Conditioning C0/C1 | new module (set arithmetic against the cloud's boards) | small, pure |
| ConditioningTrace | extend timeline cache key; thread masks in dilation | the one real engine change |
| Cloud/risk/bounds/bank/search/postures | NONE | — |
| Scheduler/VOI | read the reducibility tag | small |
| C2 inverse-dynamics | later, priced as a VOI-purchasable narrowing | deferred |

The bottom row of zeros is the factorization's claim made falsifiable — as
AMENDED under the composition lens's red team (09-doc): zero soundness laws
and zero bound arithmetic change, but the bot's MODAL BEHAVIOR shifts
(posture residency, lever spend, frozen-slot occupancy) and those three are
pre-registered bands, not surprises (09-doc §9). Two rows above also gain
riders: the frozen-slot field needs the priority partition + saturation
relief of 09-doc §3, and the scheduler row's tag is the operation-set form of
09-doc §4.
