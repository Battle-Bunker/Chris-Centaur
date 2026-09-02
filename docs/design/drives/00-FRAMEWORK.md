# 00 — DRIVES AND PREFERENCES: the framework

DRIVES lens, first document. Mandate (owner, verbatim in substance): *operator
affordances to configure the existence and weight of DRIVES — goals like goto,
attack, trap, collect, and fears like beware entrapment or attack from that
unit — and PREFERENCES — untargeted inclinations like food collection and
territory maximisation — during games*, on a long-running branch, under a UI
that stays familiar.

Two branches already did half of this work and this document does not repeat
them. `design/operator-guidance` factored the *affordance space*
(`00-FACTORING.md`: PORT × SCOPE × CONSTRUCTOR × LIFECYCLE × AUTHORITY) and
walked each port into the search (`01-INTEGRATION.md`). `design/joints-composition`
supplied the *laws* (`07-SYNTHESIS.md` §2–3) and the carried premise
(`05-ADVANCE-AND-COMMITMENTS.md` §4). What neither wrote is the object the
owner actually asked for: **what a drive IS inside the bot**, as a first-class
part of its architecture rather than as a payload arriving from outside — and
therefore what a *repertoire* of them is, what plugging one in costs, and which
four seams the whole repertoire has to fit through.

Everything below is checked against this worktree (`feature/drives-preferences`
@ `1b8d571`) with `file:line`. Where a claim depends on work landing
concurrently on `claude/succession-doc-subagent-orchestration-n41iua`
(the substrate rewrite) or `feature/decision-lens`, it says so.

---

## 1. The two objects, and why they are one row

### 1.1 The shipped preference already exists and is already validated

A **PREFERENCE** is a weight on a member of the fold. It is not a proposal —
it ships:

```ts
export const DEFAULT_WEIGHTS: Readonly<Record<string, number>> = {
  material: 10, reach: 1, room: 3, healthEconomy: 0.5, kingMargin: 0.25,
  command: 2, food: 4, momentum: …, contest: …, tier: …, energy: …,
}
```
`src/lobster/evaluate/calibration.ts:47`, folded over the eleven members of
`FEATURES` (`src/lobster/evaluate/features.ts:929`) by `fold`
(`src/lobster/evaluate/bound.ts:183`), carried in a `CriterionProfile`
(`calibration.ts:220`), bound per game through the config store
(`src/config/bot-binding.ts`), and validated at construction by `checkWeights`
(`src/lobster/evaluate/index.ts:219`).

So the owner's *"untargeted inclinations like food collection and territory
maximisation"* are `food: 4` and `reach: 1` / `room: 3`. **The preference half
of the ask is a UI over a table that already exists, already has an identity,
and already refuses to be misconfigured silently.** The per-game bot binding
(`bot.game.<gameId>` → a profile, `bot-binding.ts:27-33`) is exactly *preferences
at rest*: the settings a team carries into a game before anybody clicks
anything. The in-game affordance is the same table, edited live.

That is the first simplification this framework buys: there is no new
"preference system". There is a live editor for `CriterionProfile.weights`,
and one rule — §4.1 — about what a live edit does to everything computed under
the old one.

### 1.2 A DRIVE is a preference whose member is generated from a referent

A **DRIVE** is the same row with a referent:

```ts
interface Drive {
  readonly id: DriveId            // NAME. Premise tags and echoes cite it. Law I
  readonly scope:                 // WHOSE behaviour it colours (never an enemy's)
      { kind: 'unit'; unitIds: ReadonlyArray<UnitKey> }
    | { kind: 'team' }
  readonly constructor: MemberId  // 'drive/goto-ramp@1' — kernel code, catalogued
  readonly referent:              // the constructor's declared parameter type
      { kind: 'cell'; cells: ReadonlyArray<Coord> }      // 1 = cell, n = region
    | { kind: 'unit'; targetId: UnitKey }                // ours (escort) or theirs
    | { kind: 'event'; predicate: MemberId; params: Readonly<Record<string, number>> }
    | { kind: 'none' }                                   // ⇒ this row is a PREFERENCE
  readonly weight: number         // ≥ 0 ALWAYS. The sign lives inside the member (§6.3)
  readonly authority: 'weight' | 'determine'             // §5.2 — two values, not five
  readonly lifetime:              // the Carried lifetime, joints 05 §4
      { kind: 'turn' } | { kind: 'turns'; n: number }
    | { kind: 'until'; mode: 'latched' | 'maintenance' }
    | { kind: 'standing' }
  readonly born: { turn: number; at: number }
  readonly by: OperatorRef | null // null ⇒ authored by the bot binding, not a click
}
```

with **completion** carried by the constructor, not by the row: a constructor
declares its own completion predicate member, and `lifetime.until` says whether
satisfying it retires the drive (`latched` — goto's arrival) or merely puts it
to sleep (`maintenance` — hold-this-region, re-derived from the observed board
every turn and back the moment it is violated).

`referent.kind === 'none'` is a preference. There is one row type, two
authoring modes — *generated field* versus *seated field* — which is the
operator-guidance carve's conclusion (`00-FACTORING.md` §2, "has-target
dissolves into CONSTRUCTOR") stated as a data shape rather than as a taxonomy.

### 1.3 Goals and fears are the same object; sign is UI vocabulary

The owner names both directions (*goals like goto, attack, trap, collect*;
*fears like beware entrapment or attack from that unit*). The framework treats
them identically as rows, and the reason is not the platform's ("it's purely
semantic" — `00-FACTORING.md` §3 shows that claim fails against a worst-case
floor). The reason is the bound algebra:

```
scale(a, k) throws when k < 0:
  'feature weights must be non-negative; put the sign inside the feature'
```
`src/lobster/evaluate/bound.ts:79-86`. A negative weight flips which endpoint
of an interval is the bound and silently unsounds the whole fold. So a fear is
**a member returning negative bounds at a positive weight**, exactly as
`calibration.ts:41-45` already says of penalty features. Sign is a property of
the *constructor*, visible in the catalogue and in the UI verb, and it is never
a property of the weight vector.

The operational asymmetry the guidance lens found survives and is a
**constructor-catalogue fact**, not a framework axis: our reduction is already
maximally fearful over the priced support, so a fear expressed only as a
negative value term double-counts what the min already counts. A fear
constructor whose real job is *"this unit is a contestant even though geometry
has not triggered the gate"* belongs to the support side and is out of scope
for this branch until the A2 port exists (`01-INTEGRATION.md` §3.3). Until
then the catalogue ships fears whose honest content is a graded aversion
(*stay off this file*, *do not enter that pocket*) and says so in the row's
help text. **This is a real expressiveness limit and it is the first thing to
tell the owner**, because "beware attack from that unit" is the fear he named
and it is the one whose correct implementation is a support demand.

---

## 2. The compiled object, and the one move that makes this cheap

Per decision, the live drive set plus the board compiles to one plain value:

```ts
interface DriveProfile {                     // a CriterionProfile, extended
  readonly name: string
  readonly weights: Readonly<Record<string, number>>   // seated + 'drive:<id>' rows
  readonly reachHorizonTurns: number
  readonly command?: CommandKnobs
  readonly healthReserveRatio?: number
  readonly drives: ReadonlyArray<Drive>      // PLAIN DATA. The rows, canonicalised
}

/** The ONE constructor. Returns the fold's member list and its weight table
 *  as a single value, so the two can never disagree. */
function profileFor(base: CriterionProfile, drives: ReadonlyArray<Drive>):
  { profile: DriveProfile; features: ReadonlyArray<Feature<EvalContext>> }
```

Three consequences fall out of the shipped code with no new machinery, and they
are the reason this shape was chosen over every alternative:

**(a) `checkWeights` becomes a theorem instead of a check.** Today
`checkWeights(profile, FEATURES)` (`bot-binding.ts:314`, `evaluate/index.ts:109`)
refuses a profile that names a key the fold has no feature for, or omits one
the fold would silently apply a default to. Compiled together, a drive row
always yields exactly one member and exactly one weight entry, so the check
cannot fail for a drive — but it stays, because it still catches a hand-written
preference edit. **The only change at either call site is the second argument:
`FEATURES` becomes `featuresFor(profile)`.** Two lines.

**(b) The premise fibration is free.** The bound bank's evaluation memo keys on
`evaluationIdentity`, which is derived *structurally over the whole profile*:

```ts
get evaluationIdentity(): string {
  return `BoundEvaluator(${structuralIdentity(this.profile)})`
}
```
`evaluate/index.ts:133`, over `structuralIdentity` at
`src/lobster/contracts.ts:83`, which walks plain objects and arrays key by
sorted key. Because `drives` is **plain data on the profile**, a drive added,
retargeted or re-weighted changes the evaluation identity automatically, and
every memo, bank basis and telemetry row computed under the old drive set stops
comparing with the new one — by the mechanism the file's own comment says it
exists for ("*the failure mode of forgetting to add one to a hand-written key is
a wrong number, not a slow one*"). This is `guidanceId`
(`operator-guidance/02-WIRE-API.md` §6) landing for free instead of being built.

*Warning, and it is the one place the shape can be got wrong:* if drives are
carried as compiled `Feature` objects rather than as rows, `structuralIdentity`
hits the `function` branch (`contracts.ts:96`) and keys on object identity, so a
re-compile of the same drive set mints a fresh key and throws the memo away
every decision. **Rows on the profile; features derived beside it.**

**(c) The bot address absorbs drives with no schema change.** `botId` /
`behaviourId` (`src/config/bot-identity.ts`, `build-identity.ts`) already
address a profile. A live drive edit is a *dial excursion* producing a new
address, which is precisely the case `bot-binding.ts:29-31` says had nowhere to
persist. So "did the operator's drive help" becomes a paired A/B over addresses
the harness already records, and `docs/design/operator-guidance/02-WIRE-API.md`
§7's telemetry table becomes a set of reads rather than a set of instruments.

---

## 3. The four joints

A drive may enter the bot at exactly four places. The list is closed: a
proposed drive that needs a fifth is a proposal to change the architecture, and
should be argued as one.

| # | joint | kind (joints §2) | what a drive contributes | the law it obeys | what it may never do |
|---|---|---|---|---|---|
| **a** | `value/terms` — the fold | VALUE | one member + one weight, at a declared participant scope | non-negatively weighted sum of monotone-bounded features (`bound.ts:179-183`); R1–R3 per member (`bound.ts:11-15`) | raise a floor it did not earn; carry a negative weight; exceed the budget (§6.4) |
| **b** | `order/candidates` — the candidate layer | ACTION | an ordering slot, and (for `determine` rows only) a closure | additive over the currency, closure by intersection (joints `02-JOINT-INVENTORY.md` §1 rows 6–7) | *admit* a candidate a safety closure refused (§6.2) |
| **c** | the pin / lock context | ECONOMY / kernel constraint | a determination: this unit, this cell, this turn | `observe(determination)`; lifetime ≤ one turn; the bot never auto-unpins | live longer than a turn; arrive by any path but the shipped pin stream |
| **d** | the completion / advice surface | ADVICE | an event: activated, satisfied, invalidated, outvoted | one-way — no staged-plan joint reads it (joints §2, Law V) | feed back into (a)–(c) without a human act between |

### 3.1 Joint (a) — the fold's weights, per unit and per team

A drive compiles to one `Feature<EvalContext>`:

```ts
{ key: `drive:${d.id}`, defaultWeight: d.weight,
  contract: { reads, cliff: false, dischargeable: true },
  evaluate: ctx => …  }
```

**Scope lives inside the member, not beside it.** Today's fold is per-team:
`scorePlan(sub, plan, asTeam)` and every member reads a team-wide `EvalContext`
(`features.ts:103`). Adding a per-unit weight *column* would be a second
composition law on the same joint, which the VALUE law forbids. Instead a
unit-scoped drive's member reads only the units in `d.scope` and returns zero
for a plan that moves none of them; a team-scoped drive sums over the team.
The fold stays one law over one context, and "per unit / per team" is a
constructor parameter. **No new column, and `PlanEvaluation.parts`
(`bound.ts:171-176`) carries `drive:<id>` beside `material` with no change at
all** — which is what makes the guidance echo (`operator-signals/07-WORKED-FRAME.md`,
*"your near(queen) pull is being outvoted this turn by the contest flow"*) a
read of the shipped explain surface (`evaluate/index.ts:164-193`) rather than a
new instrument.

**Two classes of drive member, and the distinction is load-bearing.** The
admission contract (`bound.ts:124-151`) makes a feature name every uncertain
input it reads:

| referent | reads | resulting bound | consequence |
|---|---|---|---|
| **cell / region** | nothing uncertain — our own unit's destination and a fixed cell | `point(stat)`: `lo === est === hi` (`bound.ts:65`) | exact, collapses trivially, costs the search **nothing in pruning power** |
| **our unit** (escort) | that unit's own planned destination — inside the plan | `point(stat)` | same |
| **enemy unit** (pursue, avoid) | `held-arrival`, `maybe-head-presence` | a genuine interval, monotonicity declared, verified by the law harness | honest, and it **widens** the plan's bracket, so it costs pruning |

That table is the whole soundness story for joint (a) and it is *checkable*:
`checkSoundness` / `checkMonotone` / `checkCollapse` (`src/lobster/evaluate/laws.ts:149,197,248`)
verify R1–R3 by brute force over the actual world set. **A drive constructor
enters the catalogue with law cases or it does not enter the catalogue.** That
is the admission fee for the whole repertoire and it is the reason a repertoire
can be plugged in at all without re-arguing soundness each time.

### 3.2 Joint (b) — the candidate layer

Two different powers, and conflating them is the defect
`02-JOINT-INVENTORY.md` §3 names (`CandidateKnobs` is three kinds in one bag,
`keepQuiet: 2` a number in a knob bag that closes a set):

- **Order.** A drive's per-candidate stat is a namable slot in the candidate
  order. This matters more than it sounds: the cap binds on **100% of slider
  decisions**, a queen's ~64 mean options cut to 4 by a weight-blind
  comparator (joints `07-SYNTHESIS.md` §4, finding 6), so on a piece board *a plan the
  ordering drops is priced by no evaluator at any weight*. A goto whose target
  is 30 squares away and whose weight is small is invisible unless it can
  reach the order. So the drive's contribution to (b) is not a luxury — for
  sliders it is the only channel that works.
- **Closure.** Only an `authority: 'determine'` row closes a set, and it does so
  by *intersection with what the safety closures already left*, never by union.
  §6.2 states this as an invariant with its proof.

### 3.3 Joint (c) — the pin / lock context

Determinations do not change. `manual` and `hold` reach the kernel today
through the staging ladder → `isPinningSource` (`src/wire/pin-events.ts:69-79`)
→ `TeamPinLedger` (`src/lobster/pins.ts:53`) → `SearchContext.pins`, with
`matchPin` resolving against the pruned ledger so a human-authorised sacrifice
already plays. **The framework adds nothing here and must not.** What it does
is give the two an honest name: they are drives with `authority: 'determine'`,
and their row exists so the UI, the replay and the echo see one vocabulary —
but their *transport* stays the pin stream, because a determination has a
turn-scoped lifetime and a conformance protocol that a weight does not.

`hold` is the case that looks like a counterexample and is not. It is a
STANDING order (`active-game-manager.ts:2314-2317`: it re-resolves to the
piece's own index on every new board and stays in force across turns) staged as
`source: 'manual'`, i.e. as a pin. Under the framework the two halves separate
cleanly and the separation is the point: **the durable object is the drive row,
whose `lifetime` is `standing`; the pin is turn-scoped and re-minted from it at
each board ingestion.** §7's "no standing determination" is a rule about the
*pin*, never about the row that keeps re-minting one.

**And a finding that belongs here rather than in §3.1, because it is the
mis-seating this branch exists to correct:** `PINNING_SOURCES` today is
`{'manual', 'waypoint'}` (`pin-events.ts:70-74`). A goto/near step is therefore
**already a determination** — `observeStaged` (`pin-events.ts:127-135`) turns it
into a binding pin the next decision's kernel is constrained by. So the shipped
goto is not the weight its own design comment says it is
(`active-game-manager.ts:2015-2017`: *"a click-target never dictates the move …
a weighted vote in the same matrix"*); it is a hard constraint whose direction
is chosen *outside* the search by a manager-side re-score, and then handed to
the search as fact. That is joint (c) doing joint (a)'s work, one turn late.
`01-UNDER-THE-CURRENT-CONTROLS.md` §2 measures what it costs.

*This is a correction to the framing in the brief.* Manual and hold are **not**
"drives with total weight". There is no such weight: any finite weight is
outbiddable (which is not what `H` means to an operator), and an infinite one
poisons the interval arithmetic — `scale(bound, ∞)` on a zero endpoint is
`NaN`, and `clampEst` (`bound.ts:101`) exists precisely because infinities in
this algebra are lattice elements and never scalars. So `authority` has two
values and the ladder is short: **weight, or determine.** Everything in the
operator-guidance authority ladder between them (A0 attention, A2 widen, A3
license) is a *different port*, not a different drive strength, and none of
those ports exist yet on this engine.

### 3.4 Joint (d) — completion, and why it is the interesting one

A drive's completion is an **event**, not a state read. Three kinds:

```
activated   — an `until` drive whose activation predicate began to hold
satisfied   — its completion predicate held; latched ⇒ retired, maintenance ⇒ dormant
invalidated — its referent died, became unreachable, or its scope emptied
outvoted    — it was live, it contributed, and the staged plan went the other way
```

The first three are computed at board ingestion, where `checkGotoArrival`
already runs (`src/server/active-game-manager.ts:3459`) and where the goto
queue already shifts. The fourth is the one that has never existed and is the
single most valuable thing this branch can ship for the operator: **"why is the
bot not doing what I asked"** is answerable *only* as a read of the ordering's
premise tags plus the lifecycle ledger's `set_aside` dispositions, and it has
three different answers with three different remedies — the drive was refused
at admission, outvoted in the ordering, or beaten at the reduction. Without it,
a drive that quietly loses is indistinguishable from a drive the bot never
received, which is the exact failure this branch would otherwise ship — and it
is not hypothetical. Today, under `CENTAUR_ENGINE=lobster`, a snake's `goto`
is re-scored by `getWaypointBiasedMove` against telemetry rows whose breakdown
keys belong to a different vocabulary, so the operator's own weight arrives at
its default legacy magnitude on a scale thirty times smaller and both of that
path's safety vetoes read absent keys and pass everything
(`01-UNDER-THE-CURRENT-CONTROLS.md` §2, with the four `file:line` steps). The
operator sees a target obeyed and cannot see that it was obeyed for the wrong
reason.

Joint (d) is one-way. Nothing in the staged-plan path reads it.

---

## 4. Identity, precedence, composition

### 4.1 Identity: two ids, obeying different laws

Law I from the joints lens (*names find, hashes validate*):

- `DriveId` is a **NAME**, stable for the drive's life. Premise tags, echoes,
  `provokedBy` joins and the operator's UI cursor all cite it. Re-weighting a
  drive keeps its id; retargeting keeps its id (it is the same intention with a
  new referent); removing and re-adding mints a new one.
- `driveSetKey` is a **HASH** of the canonicalised live rows, and it arrives
  free as a component of `evaluationIdentity` (§2b). It validates: two scores
  under different keys do not compare.

A cache keyed by name is a bug; a carry keyed by hash is a bug. The split is
what lets a *re-weight* be cheap (§4.4) while a *retarget* is not.

### 4.2 Precedence: there isn't one, and that is the point

Today's commands are a discriminated union with a hand-written ladder:

```ts
export type SnakeIntent =
  | { kind: 'heuristic' } | { kind: 'manual'; … } | { kind: 'goto'; … }
  | { kind: 'near'; … }   | { kind: 'hold' }
```
`active-game-manager.ts:269-276`, resolved by `computeIntendedMove`'s four-rung
ladder (`:2019-2061`: manual > waypoint > bot > `'up'`). Mutual exclusion is
structural — *setting a goto destroys a near* — because a union has room for
one thing.

Drives are a **set**. Two drives on one unit do not arbitrate; they are two
members of one fold and they **compose additively**, which is the fold's
existing law applied to new members and not a new rule. `goto(A, cell)` +
`avoid(A, region)` is a unit pulled one way and pushed another, resolved by the
same arithmetic that resolves `food` against `room` today. A team-wide fear is
one team-scoped member every unit's plan is priced against.

**Deleting the ladder is most of the code this branch removes.** The ladder
exists only because the union forces a choice; a set forces none. What survives
is one genuine precedence, and it is not between drives:

> A `determine` row outranks every `weight` row on the same unit, because it is
> a constraint and they are terms. That is not an arbitration policy — it is
> the pin path doing what it already does, and the search paying for it
> (`search/core.ts` header: *"the only thing the search does about a pin is pay
> for it"*).

When a determination overrides live weights, joint (d) says so with
attribution: *"your goto on A was superseded by Ben's pin"*. Attribution, not
silence — the rule the guidance wire states as its worst failure mode
(`02-WIRE-API.md` §5: a directive the operator believes is live and the bot
never saw).

### 4.3 Composition, three cases worth naming

| case | what happens | why it is not a special case |
|---|---|---|
| two goals on one unit | both members fold; the plan that serves both scores highest | additive VALUE law |
| a goal and a fear on one unit | fold; the fear's member returns negative bounds | same law, sign inside the member |
| a team fear + a unit goal that walks into it | the unit's plan pays the team term at team scope; the joint search prices the trade across the team, not per unit | the fold is already per-team (`scorePlan(sub, plan, asTeam)`) — this is the case a per-unit ladder gets structurally wrong |

### 4.4 Edits: two taxa, two invalidation rules

The twice-invented rule (`00-FACTORING.md` §1 Reading 3, and
`waypoint-pathing.ts`'s own header): **targets and magnitudes are state;
fields, routes and stats are derived and recompute from the live board.**

- **re-weight** (magnitude only) — the fold's `parts` are stored *unweighted*
  (`bound.ts:171-176`), so a weight edit re-folds at read. Cheap by
  construction, exactly as the platform's own design found.
- **add / remove / retarget** (structural) — changes the member list, therefore
  `evaluationIdentity`, therefore the memo namespace. Everything priced under
  the old set stops comparing; the next tranche demotes softly. No new
  invalidation machinery: this is the bank's basis discipline doing its normal
  job.

Every edit carries **the turn it constrains**. This is not optional and the
reason is on the record: a turn can resolve the instant every player commits,
so turn N+1's edits land while turn N's decision is still running, and a
consumer that cannot tell them apart applies the drive to the wrong board
(`pins.ts:66-79`, the V4 B5 lesson, and `pin-events.ts:62-67` verbatim). The
drive stream inherits the pin stream's buffering rule wholesale.

---

## 5. The wire and storage shape

### 5.1 One durable table, and it must be a replay event

Drives live in one document per `(game, team)`, rows keyed by `DriveId`, LWW
per row with visible attribution, rules-gated to the team. That is the LIVE
object — the set a decision compiles against — and it is authoritative only for
"now".

The durable record is **not** a second copy of it, and this is the one place
the first draft of this document was wrong. The obvious home is the per-turn
command snapshot (`CommandTurnState`, `active-game-manager.ts:319-328`), which
already persists `waypoints`, `routes`, `activeIntentModes` and `operators` per
turn so the history viewer replays command state through the live render paths.
But `feature/decision-lens` §2.7 **deletes `command_turn_states`**, and its
reason applies to drives exactly: *a denormalised snapshot beside an event log
of the same facts — two representations of one state disagree; that is not a
risk, it is a schedule.* Adding drive rows to a table being deleted would buy a
migration and a disagreement.

So: **the durable record is the event log, and the live set is a fold of it.**
`turn_events` (lens §4.3) stores each `drive.*` event verbatim; the live set for
a turn is `applyEvent` folded from the turn's anchor. Replay then shows **what
was asked** beside what was played — from the same bytes, by the same reducer,
which is the lens's Law C — and that is what makes a drive's effect reviewable
at all. The lens's own rule governs any cache we later want: a stored table
that is a pure fold of stored events is legitimate *iff* a boundary test asserts
the fold reproduces it and a rebuild command exists.

### 5.2 Aligned with the lens's event type — one type, not two

`feature/decision-lens` (`04-SYNTHESIS.md` §4.2) settles the event shape:
`TurnEvent` — one type, two producers (kernel via `KernelInput.lens`, manager
directly) — with `seq` the only sort key, `causedBy` / `answers` for
provenance, `actor` for attribution, and the law that **live and replay are the
same pure fold over the same event type**. Drives do not mint a second
vocabulary. They add four `TurnEventKind` values:

```
'drive.add' | 'drive.remove' | 'drive.reweight' | 'drive.completed'
```

with payloads `{ drive }`, `{ id }`, `{ id, weight }` and
`{ id, how: 'satisfied'|'invalidated'|'activated'|'outvoted', why }`. They join
the manager-produced half of `TurnEventKind` beside `'operator.command'` and
`'pin'`, and they are stored in `turn_events.payload` verbatim like every other
kind, so no schema change is owed and no second writer appears. The `actor`
field is already the shape we need — `{ kind: 'operator'|'bot'|'server'|'wire';
id; name; color }` — carrying the operator, or `kind: 'bot'` for a
binding-authored preference; `answers` carries the advice artifact a drive
responds to, which is the uptake number the program has never had.

One consequence worth stating because it is free: `driveSetKey` (§4.1) is a
fold of the same events, so a replay can reconstruct **the exact drive set each
decision ran under** and check it against the `evaluationIdentity` the decision
recorded. A mismatch is a bug report, not a mystery.

Two rules inherited from that branch and worth restating because they are easy
to violate:

1. **`UnitKey` on the wire, `UnitId` in the kernel.** The lens sink translates
   at the kernel boundary — the one translation point `pins.ts:12-19` already
   owns. *A stored record carrying a substrate number is a record that cannot
   be read one turn later.*
2. **Frames are whole, never deltas.** A `drive.*` event carries the row, not a
   patch against a state the consumer had to have seen.

### 5.3 What never travels on this wire

- **Determinations.** Manual moves, `Submit All` and per-warrant authorisations
  stay on the staging wire. They are moves, not configuration, and their
  humans-always-win path must not acquire a second home (§3.3).
- **Speculation.** "What if this unit went east?" is ephemeral: it must not
  write a row, because a row changes `driveSetKey`, which invalidates caches —
  and interrogation must be cheap exactly when it is most wanted
  (`06-OUT-HANDSHAKE-CLOSURE.md` §2). Speculation rides the tentative-pin
  transport that already exists.
- **Bot opinions.** Advice flows on its own surface; the only trace here is the
  id a drive cites.

---

## 6. The invariants

Each is stated so it can be tested, and each names the shipped code that makes
it true rather than the convention that hopes so.

### I1 — A drive can never make the fold unsound

**Statement.** For every drive set D and every weight vector w ≥ 0, the folded
bound satisfies R1 (soundness), R2 (monotonicity) and R3 (collapse).

**Proof.** `fold` is a non-negatively weighted sum, and a non-negatively
weighted sum of monotone-bounded features is itself monotone-bounded
(`bound.ts:178-183`, and the file says this is the only reason the per-feature
contract is worth demanding). So the total inherits R1–R3 from its members. A
drive member is admitted to the catalogue only with a `BoundContract` and law
cases verified by brute force over the world set
(`laws.ts:149,197,248`). ∎

**Test.** A catalogue conformance suite: for every constructor, over the
acceptance boards, `checkSoundness ∧ checkMonotone ∧ checkCollapse`. A
constructor that fails does not ship. Note the corollary that makes the common
case free: **cell-referent drives read no uncertain input, so they are
point-valued and cost the search no pruning power at all** (§3.1).

### I2 — A fear can never override a certain-fatal prune

**Statement.** No weight on any drive can cause a candidate refused by a safety
closure to be considered, and no weight can cause a certain-death candidate to
be staged in preference to a survivable one.

**Why it holds structurally, in two halves.** *Sets and orders are different
joints.* Closure composes by intersection and lives in the kernel
(`candidates.ts`' prune chain: `pruneFatalNoGain`, `kingHardSafety`,
`refuseTerrainFatal`, and the regicide veto); a weight composes additively in
the fold. A weight cannot open a set it does not participate in. And on the
staging side the shipped vetoes are candidate-level and prior to scoring:
`pickBestMove`'s fatal-pocket and regicide vetoes for snakes, and
`bestPieceCandidate`'s (`active-game-manager.ts:2385-2400`) explicitly reasoned
counterpart (`active-game-manager.ts:2386-2400`) — *"the hard guarantee on top
of the strongly-negative deaths weight already inside `score`, which a large
enough waypoint bonus could otherwise outbid on a low-health piece"*. **That
comment is the invariant, already written, already load-bearing: it says in so
many words that today's goto weight is a thing a veto has to protect against.**

And a per-site veto is a thing that can be true at one site and false at the
other. It already is. The PIECE veto computes `fatal` and the regicide flag
from the vendored engine on every candidate (`computePieceCandidates`,
`:2540-2560`), so it holds. The SNAKE veto reads `breakdown.trapped ?? 0` and
`breakdown.regicide ?? 0` off telemetry rows whose breakdown is keyed by
lobster feature names (`telemetry.ts:672-683`), so under lobster both defaults
fire and `pickBestMove` filters nothing (`decision-engine.ts:95-98`). Under
this framework the protection stops being a per-site veto and becomes the joint
separation — the same guarantee at one place instead of two, and therefore at
one place instead of one-and-a-half. `01-UNDER-THE-CURRENT-CONTROLS.md` §2.3
carries the repair either way, because it is a bug on the current architecture
and does not wait for this one.

**The one exception, and it is not an exception.** A human may still stage a
death: `matchPin` resolves against the pruned ledger, so a determination plays
what the closure refused. That path is A4, turn-scoped, consented
(`FatalMoveConsent`, `active-game-manager.ts:196-206` — two mint points, both
private to the module), and it is untouched here.

### I3 — Bounds stay sound under any weight vector

**Statement.** Editing weights — including to zero, including mid-decision —
changes no `lo` or `hi` claim's validity.

**Proof.** Weights scale members; `scale` refuses negatives (`bound.ts:79-86`);
`est` never adjudicates (`contracts.ts:112-113`, `bound.ts:31-33`); terminal
outcomes enter by meet and join, never by addition (`bound.ts:43-49`,
`clampTo`). A re-weight therefore re-folds an interval sum whose every term is
already sound. Mid-decision, the fibration keeps pre-edit and post-edit scores
from comparing (§4.4). ∎

### I4 — The budget: a drive cannot buy a death

**Statement.** `Σ_d weight(d) × sup|stat_d| < CLIFF_MATERIAL_WEIGHT × (lightest
unit weight)`, checked when a drive set is accepted, refused with the rule and
the headroom named.

Today this is a comment ("*keep both below the death penalties*"). Under the
framework it is a validation, and it has the number: the cliff is denominated
in material and `CLIFF_MATERIAL_WEIGHT = 10` (`calibration.ts:161`), with every
other term deliberately an order of magnitude inside it (`calibration.ts:47-80`,
e.g. *food: 4, "because the term's whole range is [0,1] by construction — so
4 × 1 still sits well inside the cliff ceiling and can never buy a unit's
life"*). A drive constructor declares `sup|stat|` (1 for every ramp), so the
budget is arithmetic on data. **A drive set that could outbid the cliff is
refused at accept time and the operator is told why.** Refusing loudly is the
rule the whole config layer already runs on (`bot-binding.ts:38-49`).

### I5 — The empty set changes nothing

With no drives, `profileFor(base, [])` returns `base` and `FEATURES`, the
weight table is byte-identical, `evaluationIdentity` is unchanged, and every
path is the path that ships today. This is the L0 standard: **the object proves
itself by changing nothing** — and it is the first test written, not the last.

### I6 — No joint with one member

Joints §6: *a collection of one is a constant wearing a socket's clothes.* The
drive **catalogue** may not ship with one constructor per referent type as a
gesture. It ships with the constructors that have a caller and a law case:
`goto-ramp` and `near-ramp` on day one because they exist
(`gotoProgressStat` / `nearProgressStat`, `src/logic/waypoint-pathing.ts`, with
a unit-tested ramp table at `src/tests/waypoint.test.ts:62-94`), and each
further one when a repertoire item needs it. The framework's value is that the
*second* constructor costs a member and a law case, not an architecture.

---

## 7. What this framework refuses

- **No config language.** Constructors and predicates are member ids; referents
  and magnitudes are data (Law N). A drive row holds no expressions, no
  interpolation, no cross-references. A new *kind* of drive is a branch.
- **No second scoring pipeline.** A drive is a member of the one fold. The
  manager-side mini-evaluators that exist today (§`01` doc) are the defect this
  removes, not a pattern to extend.
- **No standing determination.** Durability caps authority: an `authority:
  'determine'` row has `lifetime: turn`, always. Anything an operator wants to
  persist descends to a weight and runs beside a sound channel that can refuse
  it.
- **No operator-narrowed enemy support.** "He won't go left" is an opinion for
  the advised channel, never an edit to what the min ranges over. Widening is
  another matter and is a different port that does not exist yet.
- **No drive that reads the advice surface without a human act in between**
  (joint (d) is one-way).

---

## 8. Open questions

- **Q1 (owner).** The fear you named — *"beware attack from that unit"* — is
  properly a **support demand** (make that unit a priced contestant), not a
  weight. That port does not exist on this engine and building it is a
  measurable cost in both compute and *proof discrimination* (widening the gate
  drives more plans to refuted floors, so the bot becomes more careful and less
  proof-backed at once — `06-OUT-HANDSHAKE-CLOSURE.md` §4). Ship graded-aversion
  fears now and the real thing later, or hold the fear vocabulary until the
  port exists? Shipping a weight-shaped "fear" that double-counts what the min
  already counts would be the worse outcome.
- **Q2.** Per-unit *preferences* (a scoped override of a seated weight, e.g.
  "this unit values food less") are expressible as a scoped drive over an
  existing member, but they duplicate a seated term at a second scope and the
  fold has no participant-scope column. Worth it, or do unit-scoped drives
  cover the real cases?
- **Q3.** Drive persistence across games. A team's standing preferences are the
  bot binding; in-game drives are rows. Where does "keep this for next game"
  live — a promote-to-binding action, or nowhere on purpose?
- **Q4.** Concurrent edits by two operators on one team-scoped row: LWW with
  visible attribution, or a captain gate? Unit-scoped rows are structurally
  rare (selection exclusivity). Leaning LWW + attribution.
- **Q5.** The `outvoted` event (§3.4) needs the lifecycle ledger's `set_aside`
  dispositions, which live on the search lens's side. If that ledger does not
  land, the honest fallback is a weaker signal ("your drive contributed
  −0.4 against a winning margin of 2.1"), read off `parts`. Confirm which.
- **Q6.** Team-scoped *preferences* under multi-operator play. A weight table
  is one object per team, so two operators editing `food` are editing the same
  number, unlike two drives on two units. LWW + attribution (Q4) is defensible
  for a targeted row an operator can see the effect of; a seated weight is
  invisible until a plan changes. Does the preference editor need a captain
  gate that the drive editor does not?
