# 01 — THE DATA MODEL AND THE PIPELINE

DECISION-LENS, document 1 of the brainstorming round. This lens owns **the one
data model that live play, replay storage and the UI all share**, and the
pipeline that produces it. The UI lens owns what is drawn; the kernel lens owns
what is computed. This document owns what *exists* between them, and it is
written so that an implementer can build the types without reading the other
two.

Everything asserted about today's code is cited to a file and a line. Every
number that is not cited is marked as an estimate and appears in §10 as
something to measure.

---

## 0. The thesis, in one paragraph

The old lens — `decision_logs.move_evaluations`, one row per unit per turn, a
table of heuristic outputs per candidate move — asks *"which of this unit's six
moves scored best?"* The engine never answers that question. It maximises a
**joint plan** (`search/core.ts` invariant 2: *"per-unit values are never
composed into a team score"*), and today's telemetry has to carry a field named
`chosenIsArgmax` to admit that the staged move is frequently **not** the unit's
own best (`telemetry.ts:171-181`). A table whose shape must be annotated with
"this table's premise is false" is the wrong table. The replacement is: **the
moveset is the row.** A moveset is a complete plan projected onto a cluster of
jointly-searched units; it carries the whole plan's proved bracket; per-unit and
per-feature numbers hang off it on demand, as marginals with a named residual,
and are never summed back up. Everything else in this document — the timeline,
the conditional rankings, the source interface, the delete list — follows from
that one move.

---

## 1. Vocabulary and the three identities

Law I from `origin/design/joints-composition:docs/design/joints/18-IDENTITY-AND-TRACES.md`
§3 — *names find, hashes validate* — decides every key in this model.

```ts
type GameId  = string
type Turn    = number       // BOARD turn. There is exactly one turn domain (§9.3).
type UnitKey = string       // the WIRE unit id (snake id).
type CellIndex = number     // full-board index, as the engine numbers cells.
```

`UnitKey` is the wire id and never the substrate's `UnitId`. `pins.ts` already
enforces this at the one translation point it owns (*"a substrate numbers units
per BOARD — the two must never be conflated"*, `pins.ts:23-31`). A substrate
number is meaningless one turn later; a stored record that carries one is a
stored record that cannot be read.

| identity | law | form | used for |
|---|---|---|---|
| **`ClusterKey`** (a Name) | does not change while the thing exists | member `UnitKey`s, sorted, `+`-joined | naming a cluster across emissions and across a widening's *members*; the anchor an operator's selection survives on |
| **`MovesetKey`** (a Name) | ditto | `ClusterKey` `#` `unit@to` pairs in member order | naming one moveset across emissions; the row identity the UI selects |
| **`PlanKey`** (a Name) | ditto | every unit's `candidateKey`, canonical order | the whole-board plan a moveset was priced inside |
| **`BasisKey`** (a hash) | changes whenever content changes | `basisKeyOf(assumptions)` (`bounds/score.ts:343`) | **the fiber.** Two numbers with different `BasisKey` may never be compared, sorted into one table, or differenced |
| **`DecisionId`** (a hash) | ditto | hash of the re-run inputs (§8.2) | addressing one decision's stored record |
| **`botId` / `behaviourId`** | as `18` defines them | already exist (`config/bot-identity.ts`) | which bot produced a number; whether a re-derivation is allowed to claim equality |

`BasisKey` is not decoration. `contracts.ts` non-negotiable 5 and
`compareFloors` (`bounds/score.ts:342-347`) make a cross-basis comparison a
*refusal*, and the whole reactive-widening design in §7.3 is nothing but that
refusal, honoured at the display.

---

## 2. Clusters

### 2.1 What a cluster is

The kernel does **not** partition units today: `improve` sweeps the whole
commandable roster in danger order (`search/order.ts::dangerOrder`) and the
plan's domain is the whole modelled set. So the cluster is not read off the
search — it is **derived from the interaction structure the substrate already
publishes**, and the kernel already computes exactly this graph for its
crossfade independence test:

```ts
// kernel.ts:1804-1812 — the existing precedent
const movedCells = new Set<number>()
for (const unitId of changed) for (const c of run.input.sub.influenceOf(unitId)) movedCells.add(c)
// ... overlap against every unchanged unit's influenceOf
```

> **Definition.** A **cluster** is a connected component of the interaction
> graph `influenceOf(u) ∩ influenceOf(v) ≠ ∅` over the units this decision
> commands and the operator has not fixed, augmented with every commandable
> slider (the hub fiat).

`origin/design/search-theory:docs/design/search/02-DECOMPOSITION.md` §1 names
both halves and supplies the measurement: components are ≤3 on 98.9% of 563,557
team-turns, 88.7% are singletons, the graph is a star whose hub is a slider
89.7% of the time, and lifting the hub out is textbook cutset conditioning
(Pearl 1986) over a coordination graph (Guestrin/Koller/Parr 2002). The hub fiat
is what rescues the `n=6-with-slider` stratum from 16.1% to 96.5%.

`influenceOf` is documented as an **over-approximation** (`contracts.ts:449-451`:
*"over-approximate is safe (work repeated); under-approximate keeps stale
evaluations"*). For a lens the direction is the same and the reason is better: an
over-wide cluster shows the operator a coupling that is not there, which is
recoverable by looking; an under-wide one hides a coupling that is, which is not.

### 2.2 Pinned and committed units are excluded from membership, present in context

The owner's rule — *"operator-pinned moves are excluded from unit clusters
because those decisions are immutable to the bot"* — is exactly `search/core.ts`
invariant 3 (*"a pinned unit is not in any sweep, any repair pair, or any polish
set"*). A cluster's members are the units whose moves a moveset **varies**.

But a pinned unit is in every plan, its cell is reserved before any free unit
picks (`core.ts::seedPlan`), and it is a *declared assumption* on every bracket
(`search/basis.ts::basisOf`). It therefore appears in the cluster's **context**:
shown on the board, named in the basis, and never a column in the moveset table.

```ts
interface Cluster {
  readonly key: ClusterKey
  readonly members: ReadonlyArray<UnitKey>        // moveset columns; unpinned, ours
  readonly context: ReadonlyArray<{               // drawn, never varied
    readonly unit: UnitKey
    readonly to: CellIndex
    readonly why: 'operator-pin' | 'committed' | 'reference-action' | 'pin-unreachable'
  }>
  readonly hub: UnitKey | null                    // the slider the fiat added, if any
  readonly edges: ReadonlyArray<readonly [UnitKey, UnitKey]>  // why this is one component
  /** Bumps whenever membership changes within a turn. See §7.3. */
  readonly generation: number
  /** The basis this partition was computed under. A pin leaving changes both. */
  readonly basis: BasisKey
}
```

`why: 'pin-unreachable'` carries the case the kernel already counts and today
tells nobody about: a committed pin naming a destination the unit's grammar
cannot reach keeps its existing choice and every emitted record carries a
`narrowing` assumption instead (`kernel.ts:479-497`, `EmitRefusal`). That is a
unit the operator believes they have fixed and have not. It belongs on screen.

### 2.3 Law C1 — the partition generates, it never values

> **Law C1.** A cluster may be used to **select, group and display** movesets.
> It may never be used to compute, bound, order or compare a score. Every
> moveset's aggregate is the whole-board bracket of a complete plan, priced by
> the unconditional bank and adjudicated by `better()`.

This is Law D1 of `search/02-DECOMPOSITION.md` §2, imported verbatim because the
lens is the first consumer with a motive to break it. Our payoff is one
whole-board `resolve` followed by one `evaluate`; two units in different
components can kill each other and a slider's ray crosses arbitrarily many
components, so `u(a) ≠ Σ_c u_c(a_c)` and the error is the difference between a
unit living and dying. **A cluster-local score would be the single most
plausible-looking wrong number this system could put in front of an operator**,
and §3.3 is the shape that makes it unrepresentable.

---

## 3. The decision record

### 3.1 The moveset

The row the owner asked for already exists inside the kernel and is thrown away.
`CandidateView` (`contracts.ts:362-372`) is a whole-board plan with its bracket,
its horizon, its vacuity cause, its floor/ceiling citations and its refutation
flag; `LeverView.candidates` is the list of them; the kernel keeps the committed
context's view in `run.lastView` (`kernel.ts:761`, written at `1093`) and nulls
it when the decision ends (`kernel.ts:1254`). Nothing reports it. **The first
implementation step of this lens is to put `lastView` on `KernelReport`.**

A moveset is that row, projected:

```ts
interface Bracket { readonly lo: number; readonly est: number; readonly hi: number }

interface Moveset {
  readonly key: MovesetKey
  readonly cluster: ClusterKey
  readonly clusterGeneration: number
  readonly rank: number                    // 1 = best in this table

  /** The cluster's members and what this moveset does with them. */
  readonly moves: ReadonlyArray<{
    readonly unit: UnitKey
    readonly to: CellIndex                 // NO_ORDER_MOVE is a statement, not an absence
    readonly path: ReadonlyArray<CellIndex>
  }>

  /** THE COMPLETE PLAN THIS WAS PRICED INSIDE. Law C1's receipt: the score
   *  below belongs to this plan, not to the projection. */
  readonly witness: PlanKey

  /** The whole-board proved bracket. Never a sum over `moves`. */
  readonly score: Bracket
  /** Which channel adjudicates. `est` under a vacuous posture, where every
   *  floor sits on the cliff by construction (`kernel.ts` RatchetBasis). */
  readonly channel: 'lo' | 'est'
  readonly horizon: number
  readonly vacuity: VacuityCause           // alive | material-dead | cloud-contingent-dead
  readonly refutedBy: WitnessRef | null    // a banked reply that punishes it
  readonly cites: { readonly lo: ReadonlyArray<UnitKey>; readonly hi: ReadonlyArray<UnitKey> }
  readonly basis: BasisKey
  readonly staged: boolean                 // this is what the wire holds

  /** The contrastive foil against rank 1 (§3.4). Null on rank 1 itself. */
  readonly foil: Foil | null
}
```

**Deduplication.** Several whole-board plans project to the same moveset. The
stored row keeps the projection once, with the **best** representative's bracket
and that plan's `PlanKey` as `witness`, and a count `seenIn` of how many priced
plans agreed on this projection. Taking the best is legal because all of them
share a basis by construction (`search/basis.ts`: *"the basis is derived from the
CONTEXT, never from the plan"*), which is the same fact that makes the ascent's
own comparisons legal.

### 3.2 What a decision produces

```ts
interface DecisionRecord {
  readonly id: DecisionId
  readonly gameId: GameId
  readonly turn: Turn                        // board turn
  readonly bot: { botId: string; behaviourId: string; engine: string; profile: string | null }

  /** Everything needed to re-run this decision deterministically. §8.2. */
  readonly input: DecisionInput

  /** The partition, per generation. Generation 0 is the one at decision start. */
  readonly clusters: ReadonlyArray<Cluster>

  /** One per kernel emission that changed the staged plan, plus the last per
   *  basis. Not one per emission — see §6.3. */
  readonly frames: ReadonlyArray<EmissionFrame>

  readonly summary: KernelSummary            // KernelReport, minus journal/levers (they are events)
  readonly outcome: DecisionOutcome          // staged / confirmed / committed / resolved, per unit
}

interface EmissionFrame {
  readonly seq: number                       // the turn's event seq (§5)
  readonly workMs: number | null             // EmitRecord.elapsedMs — null, never a silent 0
  readonly epoch: number
  readonly posture: Posture
  readonly basis: BasisKey
  readonly crossfade: CrossfadeVerdict | null
  readonly plan: PlanKey
  readonly score: Bracket
  readonly horizon: number
  /** Top-k per cluster, at this emission. §4.2 fixes k. */
  readonly movesets: ReadonlyArray<Moveset>
  /** Which timeline event this emission answered, when it answered one. The
   *  kernel already measures the latency (`ConformanceSample`, kernel.ts:501)
   *  and already knows the pairing; it simply does not record the event id. */
  readonly answers: EventId | null
}
```

`KernelSummary` is today's `TelemetryKernel` (`telemetry.ts:194-213`) unchanged —
it is a good shape — with `basisHistory`, `postureFlips`, `contexts`,
`speculative`, `committedUnits` and `crossfade` kept whole, and `journal` and
`levers` removed because they become timeline events (§5).

### 3.3 Per-unit, per-feature: marginals with a named residual

`Evaluator.explainPlan` (`contracts.ts:527`) returns **one** `PlanExplanation`
for a whole joint plan: a profile name, a bound, and `FeatureContribution[]`
(`value`, `weight`, `contribution = value × weight`). It is not per-unit, and
there is no honest way to make it per-unit by division.

So the breakdown has two levels and says which is which:

```ts
interface MovesetBreakdown {
  readonly moveset: MovesetKey
  readonly basis: BasisKey

  /** LEVEL 1 — the aggregate, per feature. One `explainPlan` on the witness
   *  plan. This is the number the moveset row shows. */
  readonly aggregate: {
    readonly profile: string
    readonly bound: Bound
    readonly features: ReadonlyArray<FeatureContribution>
    readonly exact: boolean
    readonly ledgerSize: number
  }

  /** LEVEL 2 — per member, a MARGINAL: the aggregate minus the same plan with
   *  this unit set to its reference action (NO_ORDER_MOVE). One extra
   *  `explainPlan` per member. */
  readonly marginals: ReadonlyArray<{
    readonly unit: UnitKey
    readonly delta: Bound
    readonly features: ReadonlyArray<{ key: string; delta: Bound }>
    /** The counterfactual actually priced, so a reader can check it. */
    readonly against: { readonly to: CellIndex }
  }>

  /** aggregate − Σ marginals, per feature and in total. NAMED, and expected
   *  to be non-zero: the interaction the plan has that its parts do not. */
  readonly residual: { readonly total: Bound; readonly features: ReadonlyArray<{ key: string; delta: Bound }> }
}
```

> **Law C2 (the no-sum law).** The per-unit column is a **marginal** and is
> stored beside a named `residual`. No consumer — UI, miner, or a later
> aggregation — may reconstruct the aggregate by summing marginals. A display
> that shows the marginals without the residual is showing a total that does not
> add up and hiding the fact.

This is `07-SYNTHESIS.md` §2's VALUE law (Möbius decomposition; *"the additive
law is the `k = 1` truncation"*) with the `k ≥ 2` remainder made visible rather
than dropped, and it is the operator-signals lens's FLOW discipline (*"a cached
sum is a statistic; the record above is a cause"*, `01-TYPE-SYSTEM.md` §2.2)
enforced by a field rather than by a convention.

**Cost, and therefore laziness.** Level 1 is one evaluation. Level 2 is `|C|`
more. With `|C| ≤ 3` on 98.9% of turns that is ≤4 evaluations per moveset, ≤20
for a k=5 table. Against a decision that spends ~470 evaluator nodes at a 150 ms
budget (`tests/local-game.ts:136`), computing this for every moveset of every
cluster at every emission is not affordable. So:

- **Eager**: level 1 for the staged moveset of every cluster, at the final
  emission. Off the hot path, after the kernel's last record, under the existing
  telemetry cost rule (`telemetry.ts:34-49`).
- **Lazy**: everything else, on selection, live or in replay (§7.2).

### 3.4 The contrastive foil

`better()` (`search/core.ts:410-421`) is a ladder, and it already computes the
rung and the margin and throws them away — the operator-signals lens says so in
as many words (`01-TYPE-SYSTEM.md` §2.1: *"`better()` computes the rung and
margin today and throws them away"*).

| rung | test (`core.ts`) | margin |
|---|---|---|
| `refuted` | `refutedAt(trial.bounds.best, incumbent.bounds.worst)` | `incumbent.worst − trial.best` |
| `basis` | `compareFloors(...).comparable === false` | none — a **refusal**, never a number |
| `floor` | `cmp.order !== 0` | `a.worst − b.worst` |
| `est` | `trial.est !== incumbent.est` | `a.est − b.est` |
| `ceiling` | `trial.bounds.best !== incumbent.bounds.best` | `a.best − b.best` |
| `tie` | `planTieKey(...)` | none — the searcher is indifferent |

```ts
type Rung = 'refuted' | 'basis' | 'floor' | 'est' | 'ceiling' | 'tie'

interface Foil {
  readonly fact: MovesetKey            // rank 1
  readonly foil: MovesetKey            // this row
  readonly rung: Rung                  // the FIRST rung on which they differ
  readonly margin: number | null       // null at 'basis' and 'tie'
  /** Per-feature (fact − foil) on the aggregate, largest magnitude first.
   *  At most two reach a headline (operator-signals 01 §5). */
  readonly separating: ReadonlyArray<{ readonly key: string; readonly delta: number }>
}
```

Two things this buys that today's `TelemetryContrast` (`telemetry.ts:153-181`)
cannot. First, `rung` grades the machine's own authority: a `floor` margin is a
*proof* the operator can lean on, a `tie` margin is a salted coin-flip
(`order.ts::tieKey`), and today both render as a number with no way to tell them
apart. Second, `basis` is a first-class outcome, so *"these two are not
comparable"* is a thing the table can say instead of sorting them anyway.

---

## 4. Conditional rankings

### 4.1 What "conditional on this unit move" means, exactly

> **Definition.** For a cluster `C`, a member `u`, and a candidate move `m`: the
> conditional ranking is the top-k movesets of `C` under the pin context
> `pins ∪ {u@m}` — the *same* context the kernel opens when an operator actually
> pins `u` to `m`.

Concretely, and with nothing new invented:

1. `matchPin(sets.get(u), m)` (`search/core.ts:283,304`) resolves the destination
   to a candidate, reading the **pruned ledger** after the candidate list so a
   destination the generator pruned is still pinnable — this is the mechanism
   `07-SYNTHESIS.md` finding 16 identifies as *"a human-authorised sacrifice
   already plays today"*.
2. `basisOf(ctx)` (`search/basis.ts`) adds `{kind:'operator-pin', unitId:u, to:m}`
   to the basis. **The context is a different fiber**: its brackets are not
   comparable with the unconditional ones. Every row carries its `BasisKey` and
   the UI shows the two tables side by side, never interleaved.
3. `search.conform(ctx', wirePlan)` splices the pin in and repairs legality —
   contractually cheap and never searches (`contracts.ts` SearchCore guarantees).
4. `search.improve(ctx')` refines, honouring the slice budget and resuming from
   the incumbent and the inherited witness set.

> **Law C3.** The **head** of a conditional ranking is `conform(ctx⊕pin,
> wirePlan)` by construction, not by selection from a pool. That is what makes
> the owner's sentence true — *"the same ranking that would immediately select
> the actual next staged moveset if that candidate were locked"* — because the
> kernel's actual response to a pin event is an epoch bump followed by exactly
> that conform and an immediate re-stage (`ConformanceSample.slicesBefore` is
> asserted to be 0, `kernel.ts:501-517`). Ranks 2..k come from `improve`.

If Law C3 is dropped — if the head is instead `improve`'s best-so-far — the
displayed head is *better* and *not what would be staged*, which is a lie of a
particularly bad kind: it is the number the operator uses to decide whether to
lock. This is open question O4.

### 4.2 k = 5

`k` is a member with provenance, not a magic number:

- `k ≥ 2` or the foil (§3.4) does not exist.
- The attention budget is a **cardinality** budget over a submodular value
  (`07-SYNTHESIS.md` §2, ADVICE), so the constraint is on rows-per-look, not on
  a rate.
- Cluster components are ≤3 on 98.9% of turns and 88.7% are singletons
  (`search/02-DECOMPOSITION.md` §1), and the sweep's own `candidateCap` is 8
  (`search/core.ts` `DEFAULT_TUNING`). The distinct-projection family for a
  typical cluster is therefore small; 5 is most of it for a singleton and the
  interesting head of it for a triple.
- 5 rows is a table an operator reads without scrolling, next to a board.

`LENS_TOPK = 5`, per cluster, per emission. It is a knob and it belongs in the
bot manifest, which means changing it changes `botId` and every stored row says
which value produced it.

### 4.3 How it is produced live

**Not** precomputed for every candidate. `|ours| × candidateCap` is 26 × 8 = 208
speculative contexts per emission, against a budget where *"at production team
sizes one bank `price()` is most of a slice"* (`search/core.ts` session-cache
comment). That is not a tuning problem, it is an order of magnitude.

Instead — and this is the cleanest thing in this document — **the conditional
ranking is the tentative-pin speculative context, exposed.** All of it already
runs:

| piece | where it is today |
|---|---|
| a UI hover becomes a tentative pin | `wire/pin-events.ts::tentativePin` |
| tentative pins are searched, never staged | `Pin.tentative`, `contracts.ts:223`; `basis.ts` excludes them from the basis |
| one slice in four goes to a speculative context | `KernelOptions.speculativePeriod: 4` |
| the contexts are cached, tiered, LRU | `PinContextCache`, `kernel.ts:258` |
| the contexts are reported with their basis | `KernelReport.speculative` and `.contexts`, `kernel.ts:595-620` |
| the only consumer today | `pins.ts::adviseFromReport`, which reduces the whole context to **one scalar price** |

The lens reads the same contexts and reports their `LeverView.candidates` top-k
instead of collapsing them to a scalar. Nothing new is searched.

The ranking is therefore **anytime and streamed**, exactly like the decision:

| latency | what has arrived |
|---|---|
| ≤ 1 slice (25 ms live) | rank 1, from `conform` — Law C3, and it is the number that matters |
| next speculative slice | ranks 2..k, refining |
| every subsequent one | brackets tighten; `cursor` (slices spent) rides along as the confidence channel, as `TeamPinAdvice.confidence` already does |

**Cap.** At most `pinCacheCapacity` (8) live conditional contexts, and the source
requests at most 3 (the selection plus two pre-fetches). Beyond that the
speculative share of the decision's budget stops being a tax and starts being the
decision. Three operators each hovering is open question O5.

### 4.4 How it is available in replay

Re-derived, not stored — with one exception.

- **Stored eagerly**: the conditional ranking for each unit's *staged* candidate,
  one `conform` per commandable unit after the decision ends. That is the
  question a reviewer asks first ("if I had locked what the bot chose, what
  then?"), it is `|ours|` cheap calls off the hot path, and it makes the common
  replay path a read.
- **Re-derived on demand**: everything else, by re-running `conform` +
  `improve` from the stored basis under the node clock (§8), inside the replay
  server. Deterministic, so two readers of the same replay see the same table.
- Every re-derived row is stamped `derivation: 'rerun'` with the `behaviourId`
  that produced it. §8.3 is the rule for what happens when that differs from the
  recorded one.

---

## 5. The intra-turn event timeline

### 5.1 One sequence, three clocks

One writer per `(gameId, turn)` assigns `seq`, a monotone integer. That writer is
the active game manager, which already serialises per game
(`firebase-interface.ts` `updateChain`: *"an early-resolving turn can deliver the
next snapshot while the previous one is mid-processing"*). Every event carries:

- `seq` — total order within the turn. The only thing the UI sorts on.
- `atWall` — UTC ms. For humans and for cross-turn ordering.
- `atWorkMs` — the kernel's own clock reading minus `t0`, present only on events
  inside a decision. This is `EmitRecord.elapsedMs`, which already exists and is
  already documented as *"ON THE KERNEL'S CLOCK — the same clock
  `BudgetHandle.now` reads, so a journal replayed against `KernelReport`'s
  `elapsedMs`/`budgetMs` is on one scale"* (`contracts.ts:299-330`). Null, never
  zero, when unmeasured.

`atWorkMs` is the axis that replays. Wall time does not: `03-API.md` §5 states it
as a law (*"a frame's age in ms says nothing; its age in quanta and turns says
everything, and it replays"*), and the timeline scrubber's default axis is
therefore `seq`, with `atWorkMs` as the ruler inside a decision.

### 5.2 The kinds

```ts
type EventId = string   // `${gameId}:${turn}:${seq}`

interface TurnEvent {
  readonly id: EventId
  readonly gameId: GameId
  readonly turn: Turn
  readonly seq: number
  readonly atWall: number
  readonly atWorkMs: number | null
  readonly kind: EventKind
  readonly actor: { readonly kind: 'operator' | 'bot' | 'server' | 'wire'
                    readonly id: string | null; readonly name: string | null; readonly color: string | null }
  readonly unit: UnitKey | null
  /** The event that made this one happen. */
  readonly causedBy: EventId | null
  /** The operator event this one is a RESPONSE to. Distinct from causedBy:
   *  an emission is caused by a slice boundary and answers a pin. */
  readonly answers: EventId | null
  readonly payload: unknown          // typed per kind
}
```

| kind | payload | where it comes from today |
|---|---|---|
| `board.arrived` | turn, boardHash, deadlineMs, roster, alive | `firebase-interface.ts` `onGameUpdate` |
| `stage.fastpass` | unit, move, source | the pre-decision staging the manager does on turn start (`stageMove`) |
| `decision.begin` | decisionId, basis, initialPins, assumptions, modelled/held, budgetMs, botId, behaviourId | `team-decision-engine.ts:517-546` |
| `cluster.partition` | generation, clusters | **new** (§2) |
| `emission` | EmissionFrame (§3.2) | `EmitRecord` + `run.lastView` |
| `basis.change` | epoch, posture, channel, floorLo, cause | `BasisSnapshot` (`kernel.ts:519`), `PostureFlip` |
| `lever` | kind, unit or planKey, reason | `KernelReport.levers` |
| `refusal` | EmitRefusal, count delta | `KernelReport.refusals` (`kernel.ts:479`) |
| `operator.command` | verb, target, payload | `active-game-manager.ts` `logCommandEvent`: `goto-set`, `goto-append`, `goto-remove`, `goto-target-reached`, `near-set`, `waypoint-clear`, `input-clear`, `manual-move`, `hold`, `unhold`, `suicide`, `fatal-move-confirmed`, `commit`, `command-cleared-on-death` |
| `pin` / `unpin` / `commit` | unit, to, tentative | `wire/pin-events.ts` `PinEvent`, **plus the operator attribution the typed stream does not carry today** |
| `pin.refused` | unit, to, reason | `EmitRefusal: 'pin-unreachable'` |
| `selection` | operator, cluster, unit, candidate | **new** — the UI's inspection focus (§7) |
| `conditional` | requestId, cluster+generation, locked moves, top-k, cursor, final | **new** (§4) |
| `breakdown` | moveset, basis, aggregate (level 1), per-member marginals (level 2), the named joint residual | **new** (§3.3) — the drilled row, emitted where the ask is answered, so replay shows the breakdown the operator drilled live |
| `advice` | `TeamPinAdvice` (costLo/costHi/confidence/degraded/basis) | `pins.ts::adviseFromReport` |
| `stage.requested` | unit, move, turn, source | `active-game-manager.ts` `ensureStagedPublished` → `moveSubmitter` |
| `stage.confirmed` | unit, move, serverTs | `setConfirmedStagedMove` (`active-game-manager.ts:2913`) |
| `stage.retry` | unit, move, why | the staging backstop (`active-game-manager.ts:2878-2891`) |
| `commit.observed` | unit | `finalizeTurnMove` — *"a report of observed Firebase state, nothing else"* (`active-game-manager.ts:2940`) |
| `decision.end` | KernelSummary, abandoned, stagedNothing | `KernelReport` |
| `turn.resolved` | per-unit resolved move, deaths, winners | next board's `lastMoves` |

Three of these are new; the rest are events the system already produces and
either logs into a differently-shaped table or drops on the floor.

### 5.3 The causal links that matter

- **Which emission answered which command.** The kernel already measures
  `ConformanceSample.latencyMs` *"from the operator event ARRIVING at
  `onPinEvent` to the conforming record leaving the kernel"* (`kernel.ts:501-516`)
  — so the pairing is known and only the id is missing. Carry an `EventId` on
  `PendingEvent` (`kernel.ts:795-800`) and copy it onto the emission's `answers`.
  This is a one-field change and it is the single highest-value link in the model:
  it turns "the operator pinned and then something was staged" into "this write
  is the answer to that pin, 18 ms later, 0 slices in between."
- **Which conditional ranking a lock produced.** A `pin` event whose `causedBy`
  is a `selection` event, and a `conditional` event whose `answers` is that
  selection: the chain shows that what the operator saw before locking is what
  they got after.
- **Which request a confirmation confirms.** `stage.confirmed.causedBy` is the
  `stage.requested` it acknowledges; `stage.retry` names the same one. The
  request→confirm→commit lifecycle becomes three linked rows instead of three
  independent log lines.

### 5.4 Stored per event vs recomputed

| stored | recomputed on demand |
|---|---|
| every event in §5.2, with its payload — a breakdown included, once one has been asked for | per-unit marginals and residuals (§3.3) nobody has drilled |
| the top-k movesets of the frames §6.3 keeps | conditional rankings other than the staged-candidate one (§4.4) |
| `EmissionFrame` header for every emission | foils below rank 2 |
| the board settlement, once per turn | *anything that can be derived from the settlement*: legality, paths, threat maps, territory |
| the basis and seed | the whole search, when a reader asks (§8) |

The rule: **an observation is stored; a computation is re-derived.** A stored
computation is a number that will disagree with the code that produced it as soon
as the code changes, and this repository has already paid for that class of
defect (`07-SYNTHESIS.md` §1).

---

## 6. Storage

### 6.1 The schema that replaces `decision_logs`, `turn_states`, `command_events`, `command_turn_states`

Drizzle sketch, `src/database/schema.ts`. `games`, `server_events`,
`server_liveness` and `config_store` are untouched.

```ts
// One canonical board per (game, BOARD turn). The re-run input, and the only
// thing whose loss makes a replay unreadable. Retained for the life of the game.
turn_boards(game_id, turn, settlement jsonb, board_hash, deadline_ms,
            roster jsonb, created_at)                       PK (game_id, turn)

// The timeline. §5.
turn_events(game_id, turn, seq, kind, at_wall, at_work_ms,
            actor_kind, actor_id, actor_name, actor_color,
            unit_key, caused_by, answers, payload jsonb)     PK (game_id, turn, seq)
            INDEX (game_id, turn, kind)

// One per decision. Carries the re-run inputs and the kernel summary.
decisions(id, game_id, turn, bot_id, behaviour_id, engine, profile,
          basis jsonb, seed, budget_ms, node_budget,
          assumptions jsonb, initial_pins jsonb, modelled jsonb,
          summary jsonb, started_at, ended_at)               PK id
          UNIQUE (game_id, turn, bot_id)

// The table the UI reads. §3.1.
movesets(decision_id, emission_seq, cluster_key, cluster_gen, rank,
         moveset_key, moves jsonb, witness_plan_key, seen_in,
         lo, est, hi, channel, horizon, vacuity, refuted_by,
         cites jsonb, basis_key, staged bool,
         foil_rung, foil_margin, foil_separating jsonb)
         PK (decision_id, emission_seq, cluster_key, moveset_key)
         INDEX (decision_id, cluster_key, rank)

// Per unit, per turn: what was staged, confirmed, committed, resolved.
// Replaces decision_logs' back-filled move columns without its blob.
unit_outcomes(game_id, turn, unit_key, unit_name, cluster_key,
              staged_move, staged_source, confirmed_move, committed bool,
              resolved_move, fatal_consent, operator_id)     PK (game_id, turn, unit_key)
```

Five tables where there were four, and the largest blob in the system
(`decision_logs.game_state`, written once per unit per turn) becomes one row per
turn.

### 6.2 Why `command_turn_states` does not survive

It stores *"exactly the live WebSocket broadcast shape … so the history viewer
can feed it straight into the same render paths the live client uses"*
(`schema.ts:145-152`). The intent is right and this document keeps it — §7 is
that intent, generalised — but the *mechanism* is a denormalised snapshot beside
an event log of the same facts. Two representations of one state disagree; that
is not a risk, it is a schedule. The replacement is a **fold at read** over
`turn_events` (`operator-signals 03-API.md` §1: *"every query is answered by the
engine-side store doing read-time folds"*), and the fold is the same function the
live source runs, so it cannot drift from the live path either.

### 6.3 Sizes per turn

Estimates, marked as such; the measurement is O1.

- **Events.** 1 board + 1 decision.begin + 1–3 partitions + ~6 emissions +
  0–3 basis changes + ~6–50 levers + 0–20 operator commands + 0–10 pin events +
  2 × |ours| staging rows (≤52 at the 26-unit roster) + ≤26 commits + 1
  resolution ≈ **100–200 rows**, ~200 B each ⇒ **~30 KB/turn**.
- **Movesets.** k=5 × ~8 clusters × the frames kept. Keeping every emission is
  ~240 rows; the rule below cuts it.

> **The frame-keeping rule.** Store the top-k for (a) every emission that changed
> the staged plan, and (b) the last emission of every basis. Every other emission
> keeps its `EmissionFrame` header and no movesets. Rationale: an emission that
> did not change the plan is a bracket tightening, and the tightening is on the
> header; a basis change makes the old table incomparable anyway, so the last
> table under each basis is the only one worth keeping whole.

That is typically 2–4 frames ⇒ **~80 moveset rows, ~15 KB/turn**. Plus the board
settlement, ~5–20 KB.

**~50 KB/turn, ~10 MB for a 200-turn game.** Today's `decision_logs` writes one
row per unit per turn carrying a `game_state` blob and a `move_evaluations` blob
of up to 6 explained candidates with full feature breakdowns — at 26 units that
is larger by roughly an order of magnitude. **The new lens stores less and says
more**, and that is not a coincidence: it stores the joint object once instead of
projecting it onto every unit.

### 6.4 Retention

| class | hot | then |
|---|---|---|
| `turn_boards` | forever | forever — it is the re-run input; without it nothing is derivable |
| `decisions` | forever | forever — it is small and it is the basis |
| `turn_events` | 30 days | fold to a per-turn digest: operator commands, pins, staging outcomes, decision.begin/end. Drop levers, refusals, non-staging emissions |
| `movesets` | 30 days | keep the final staged frame only; drop the rest |
| `unit_outcomes` | forever | forever — small, and it is what a result is |

A folded turn is still *inspectable*, because the board and the basis survive and
§8 re-derives the tables. That is the payoff of storing the inputs: retention
becomes a latency decision rather than a loss.

---

## 7. One source for live and replay

### 7.1 The interface

```ts
interface Cursor { readonly gameId: GameId; readonly turn: Turn; readonly seq: number }

interface DecisionSource {
  /** The moment being inspected. Live starts pinned to the head and unpins
   *  when the operator scrubs back within the current turn. */
  readonly at: Cursor
  seek(to: Cursor): void

  clusters(): ReadonlyArray<Cluster>
  movesets(cluster: ClusterKey): ReadonlyArray<Moveset>
  timeline(): ReadonlyArray<TurnEvent>

  breakdown(moveset: MovesetKey): Promise<Provenanced<MovesetBreakdown>>
  conditional(req: ConditionalRequest): Promise<ConditionalHandle>

  subscribe(fn: (d: SourceDelta) => void): () => void
}

interface ConditionalRequest {
  readonly cluster: ClusterKey
  readonly clusterGeneration: number
  readonly lock: { readonly unit: UnitKey; readonly to: CellIndex }
}

interface ConditionalHandle {
  readonly requestId: string
  /** Anytime: rank 1 first, then refinements. `final` when the source will
   *  send no more (decision ended, or the re-run's node budget is spent). */
  readonly ranking: ReadonlyArray<Moveset>
  readonly cursor: number         // slices spent — the confidence channel
  readonly final: boolean
  cancel(): void
}

/** Every derived number says where it came from. */
interface Provenanced<T> {
  readonly value: T
  readonly provenance:
    | { readonly kind: 'observed'; readonly at: Cursor }
    | { readonly kind: 'rerun'; readonly behaviourId: string; readonly matchesRecorded: boolean }
  readonly basis: BasisKey
}

type SourceDelta =
  | { kind: 'event';       event: TurnEvent }
  | { kind: 'clusters';    generation: number; clusters: ReadonlyArray<Cluster>
                         ; supersedes: ReadonlyArray<ClusterKey> }
  | { kind: 'movesets';    cluster: ClusterKey; generation: number
                         ; emissionSeq: number; rows: ReadonlyArray<Moveset> }
  | { kind: 'conditional'; requestId: string; ranking: ReadonlyArray<Moveset>
                         ; cursor: number; final: boolean }
  | { kind: 'cursor';      at: Cursor }
```

Two implementations, one type:

- **`LiveDecisionSource`** — subscribes to the websocket stream; `breakdown` and
  `conditional` are RPCs into the running kernel's speculative machinery (§4.3);
  `timeline()` is the events observed so far this turn, held in memory;
  `seek()` within the current turn replays the in-memory frames.
- **`ReplayDecisionSource`** — reads `turn_events` / `movesets` from Postgres;
  `breakdown` and `conditional` are re-derivations (§8); `seek()` is a query.

> **Law C4.** The UI has one code path. If a display needs to know which source
> it has, that is a defect in this interface, not a case to special-case. The one
> legitimate difference is `Provenanced.provenance`, which is *content* — the
> operator is entitled to know whether a number was observed or re-derived — and
> is rendered as a badge, not as a branch.

Live and replay differ in one more honest way: live is **open at the head**
(`final: false`, more emissions coming) and replay is closed. That is
`ConditionalHandle.final` and `Cursor` at the last seq, and it is data.

### 7.2 The lazy paths

`breakdown` live, *after* the decision has ended, needs a substrate — and
`TeamDecisionEngine` calls `sub.release()` in its `finally`
(`team-decision-engine.ts:600`). That is fine: a substrate is a pure function of
the board settlement, so the live source rebuilds one from the stored
`turn_boards` row exactly as the replay source does. **Live-after-decision and
replay are the same code path**, which is the strongest form of §7.1's law.

`breakdown` live, *during* the decision, uses the running substrate and costs
`1 + |C|` evaluations against the decision's own budget. Charge it: the request
rides the same speculative slice share as a conditional ranking and is refused
(with a typed refusal, never silently) when the share is spent.

### 7.3 The reactive case: a unit is unlocked mid-inspection

An operator on another seat clears their intent on unit `v`, returning it to bot
control, while we are inspecting cluster `C = {a, b}` with `a@m` selected.

1. `wire/pin-events.ts` emits `{kind:'unpin', unitId: v}`. `TeamPinLedger.apply`
   folds it (`pins.ts:130-150`); `TeamDecisionEngine.routeToKernel` hands it to
   the live kernel (`team-decision-engine.ts:815`); the kernel bumps the
   constraint epoch and re-stages a conforming plan immediately.
2. The lens's partitioner recomputes: `v` is now commandable-and-unpinned, its
   `influenceOf` overlaps `C`'s, so the component becomes `C' = {a, b, v}` — or,
   if `v` bridged two components, `C' = C ∪ D`. `generation` increments.
3. The source emits **`{kind:'clusters'}` first**, with
   `supersedes: [C]` (or `[C, D]`). The UI re-anchors on what survives: the
   selected **unit** and its **candidate** are `UnitKey` + `CellIndex` and are
   untouched. The selected **moveset** does not survive — its key names `C`, and
   `C` no longer exists.
4. Any outstanding `ConditionalHandle` is re-issued automatically against `C'` at
   the new generation, with the same `lock`. The old ranking stays on screen,
   marked `stale`, until the new rank 1 lands (≤1 slice). **It is never blanked**:
   an epoch change is the worst possible moment to take the display away from an
   operator who is deciding whether to lock.
5. Then `{kind:'movesets'}` for `C'` as the first post-epoch emission produces it.

> **Law C5 (the generation law).** Movesets from two cluster generations are
> never merged into one table, sorted together, or differenced. They belong to
> different plan families **and** to different bases: the unpin removed an
> `operator-pin` assumption from `basisOf(ctx)`, so `compareFloors` on any pair
> across the boundary returns `{comparable: false, refusal: 'basis_mismatch'}`
> (`bounds/score.ts:345`). The generation field is that refusal, made visible
> before the comparison is attempted rather than after.

Two units widening into one cluster is the interesting case; the reverse — an
operator **pins** a unit and the cluster *narrows* — is the same mechanism with
the same law, and it is the more common one. Both are one code path.

---

## 8. Determinism, and what replay can actually re-run

### 8.1 A live decision cannot be re-run bit-exactly. Say so.

Three independent reasons, each load-bearing:

1. **The production clock is the wall clock.** `defaultNow` (`kernel.ts:89`) is a
   monotonic wall timer, and slice boundaries are read off it. Slices decide how
   many `improve` calls happen and therefore which plans get priced. The
   deterministic runner exists precisely because of this: *"the runner is
   budgeted in milliseconds, so at the standard budget the decision is not
   reproducible … set the budget to 20 ms and it IS reproducible — because the
   decision is then [trivial]"* (`tests/local-game.ts:97-108`).
2. **Yields are deliberately wall-gated.** `yieldIntervalMs` is documented as
   gated on the real clock *"because what it is rationing is real event-loop
   starvation"* (`kernel.ts:380-392`), so macrotask boundaries land
   nondeterministically. The deterministic mode sets it to 0 and says why
   (`local-game.ts:410-416`).
3. **Operator events are drained between slices** with arrival stamps on the
   injected clock (`PendingEvent`, `kernel.ts:795`). Which slice an event lands
   in is a function of wall timing, not of stored inputs — and the design
   *wants* that, because it is the operator's real latency.

Storing "enough to re-run the live decision bit-exactly" would mean storing the
slice boundary times and replaying the scheduler. That is a recording of a
process, not a record of a decision, and it would still not survive a code
change. **Do not build it.**

### 8.2 What *is* bit-exact, and is the right target

A **re-decision from the stored basis under the node clock** is deterministic.
`DecisionClock` makes `now() = nodes × NODE_COST + reads × READ_COST`
(`local-game.ts:113`), which turns the one nondeterministic function into a work
counter; `local-game-determinism.test.ts` pins it. So:

```ts
interface DecisionInput {
  readonly boardHash: string          // the settlement in turn_boards
  readonly asTeam: number
  readonly seed: number               // search tie-break salt (DEFAULT_TUNING.seed)
  readonly assumptions: ReadonlyArray<StoredAssumption>   // reference actions, narrowings, posture
  readonly initialPins: ReadonlyArray<StoredPin>
  readonly modelled: ReadonlyArray<UnitKey>               // the held-capacity walk's choice
  readonly botId: string
  readonly behaviourId: string
  readonly nodeBudget: number         // the re-run budget, NOT the live budgetMs
  readonly liveBudgetMs: number       // recorded for context; never used to re-run
  readonly kernelOptions: KernelOptionsDigest
}
```

Everything in it is already computed and already thrown away except
`kernelOptions`, and every field is small. The stored `initialPins` and
`assumptions` are wire-keyed (§1), so a re-run rebuilds the substrate from the
settlement and re-translates.

> **The replay contract.** *Observed things are stored. Everything else is
> re-derived from `DecisionInput` under the node clock, and is stamped
> `provenance: 'rerun'`.* A re-run does not reproduce the live emission sequence
> and does not claim to; it reproduces **the search from the same basis**, which
> is what a conditional ranking, a breakdown and a foil are questions about.

### 8.3 When the re-run disagrees with the record

`matchesRecorded` on `Provenanced` is computed by re-deriving the *staged*
moveset and comparing it with the stored one. Three outcomes:

- **Match.** The re-runner reproduces the decision's own choice; every derived
  table beside it inherits that credibility.
- **Mismatch, same `behaviourId`.** The board or the basis was not fully captured.
  That is a bug in this model and the source refuses to serve derived numbers
  until it is fixed — better a hole than a plausible wrong table.
- **Mismatch, different `behaviourId`.** Expected: a different build plays
  differently. The source serves the derivation, badged with both ids, and the
  UI says *"re-derived by build X; this decision was made by build Y."* This is
  the early-cutoff hierarchy of `18-IDENTITY-AND-TRACES.md` §1 used for exactly
  what it is for.

Open question O9 asks whether a `behaviourId` mismatch should block the *staged*
row's derived breakdown (a claim about what happened) while allowing exploratory
conditionals (a claim about what would happen).

---

## 9. The delete list

Radical, as instructed; no compatibility layer (`07-SYNTHESIS.md` §6: *"no second
epistemic vocabulary, and no compatibility layer for the shapes being
replaced"*).

1. **`decision_logs` — the whole table.** With it: `move_evaluations` (the per-unit
   × per-candidate blob, §0), `game_state` per unit per turn, `safe_moves`,
   `position_x/y`, `health`, `bot_recommendation`, `submitted_move`,
   `server_move`, `num_states`. Replaced by `turn_boards` + `movesets` +
   `unit_outcomes`. `fatal_consent` **survives**, on `unit_outcomes`.
2. **`turn_states.territory` and `turn_states.cell_ownership`.** Whole-board
   Voronoi ownership maps per turn, from the legacy `VoronoiStrategy`. The
   lobster evaluator's territory reading is a `FeatureContribution` in a
   breakdown; the blob is the largest thing we store and nothing in this lens
   reads it. `turn_states.game_state` survives as `turn_boards.settlement`.
3. **The `board turn + 1` decision-log domain.** `UnitDecisionRow.turn` is board
   turn + 1 *"not a display choice"* (`telemetry.ts:275-287`) and every back-fill
   has to undo it. One domain: **board turn**, everywhere, in every table and on
   every event.
4. **`command_turn_states`** — §6.2.
5. **`TelemetryEvaluation` / `DecisionMoveEvaluation` / `LegacyBreakdown` and the
   two-engine dual vocabulary.** `TelemetryBreakdown.engine: 'lobster'` exists to
   tell a renderer which vocabulary it is reading (`telemetry.ts:120-133`). One
   engine writes now; the discriminator and the legacy branch both go.
   `projectedTerritoryCells`, `numStates`, and the `weights`/`weighted` mirror
   go with them.
6. **The eager explain budget.** `MAX_CANDIDATES_PER_UNIT = 6` and
   `MAX_EXPLAINED_CANDIDATES = 96` (`telemetry.ts:331,339`) exist to bound an
   eager per-candidate explain that no longer happens. Breakdowns are lazy
   (§3.3); the caps are replaced by `LENS_TOPK` and the speculative share.
7. **`turn-timeline.ts`'s `SynthesizedTurnRow` path.** Synthesising a board from a
   per-snake decision row exists only for games logged before `turn_states`.
   No backwards compatibility ⇒ delete the merge, keep nothing.
8. **`src/logic/decision-telemetry.ts`.** The pre-lobster anytime compute record:
   `moveSetsPerMove`, `nearbySnakes`, `3^k`. It describes a search this bot no
   longer runs.
9. **`TelemetryContrast.chosenIsArgmax`.** The field exists to warn that the
   per-unit table's premise is false. With the per-unit table gone, the warning
   has nothing to warn about; the foil (§3.4) says the true thing directly.
10. **`KernelReport.journal` and `.levers` as report arrays.** They become
    timeline events with `seq` and causal links. Keeping both would be two
    orderings of one sequence.

Flagged for the kernel lens rather than deleted here, because this lens cannot
see whether the team path still reaches them: `decision-chunk.ts`,
`decision-worker.ts`, `decision-worker-pool.ts`, `board-evaluator.ts`,
`voronoi-strategy.ts`.

---

## 10. Open questions for the synthesis round

**O1 — Measurement.** Emissions per decision, clusters per turn, distinct
projections per cluster, and event count per turn are all estimates in §6.3. One
instrumented run of `tests/local-game.ts` settles all four and fixes the storage
budget. Highest information per hour of anything in this document.

**O2 — Fog and the cut.** `search/02-DECOMPOSITION.md` §2b′ shows the geometric
cut `influenceOf(u) ∩ influenceOf(v)` is a *public* predicate only under full
observability; under fog a hidden unit's cloud spans components and two players
compute two partitions. Does the lens's cluster then widen to the cloud's span
(honest, possibly the whole board), or does it show the point-mass partition with
a fog badge? Kernel lens owns the answer; this model needs to know whether
`Cluster.members` can be set-valued.

**O3 — Does a pinned unit leave the cluster or stay as a fixed member?** §2.2
proposes: out of `members`, into `context`. But its influence still couples the
others' brackets, and an operator who pinned it may reasonably want to see the
coupling. Confirm with the owner — it is a display consequence but it is a data
shape.

**O4 — Law C3.** Head of a conditional ranking = `conform` (what would actually
be staged) or `improve`'s best-so-far (what the search would eventually find)?
§4.1 argues for `conform`. The owner's sentence supports it. Confirm, because the
two diverge exactly when it matters.

**O5 — The speculative share under multiple inspectors.** `speculativePeriod: 4`
is 25% of the decision for one hover. Three operators inspecting three units is
75%, and the decision they are inspecting is the one being starved. Is the cap
per-operator, per-team, or a strict budget with a queue? Interacts with
`03-API.md` §2's per-operator frames.

**O6 — Who owns `seq`?** One writer per `(gameId, turn)` is assumed (§5.1) and is
true today because the decision runs in-process. `decision-worker-pool.ts` exists.
If decisions ever leave the process, `seq` needs an owner and a merge rule.

**O7 — `LENS_TOPK` per cluster or per screen?** §4.2 sets k=5 per cluster. The
attention budget in `07-SYNTHESIS.md` §2 is per-look, i.e. per screen. With eight
clusters, 5-per-cluster is 40 rows. Does the greedy submodular selection run
*across* clusters (fewer rows for quiet clusters), and if so is the table still
one-cluster-at-a-time?

**O8 — Do we store the restricted payoff matrix?** `search/06-THE-COLUMN-SET.md`
§2 shows the matrix is already computed cell by cell and discarded, at 60 KB for a
152 × 50 decision and **zero additional resolutions**. It is the natural source of
`Moveset.refutedBy` and of the SET shape's `dominance` condition, and this lens is
the only consumer that would ever look at it. 60 KB/turn is larger than everything
else in §6.3 combined, so it is a real decision and not a free one.

**O9 — Derivation across a `behaviourId` change.** §8.3. Refuse derived numbers
for the *staged* row (a claim about what happened) while allowing exploratory
conditionals (a claim about what would happen)? Or refuse both?

**O10 — Operator scope on a shared cluster.** Two operators inspecting the same
cluster with different selections implies two speculative contexts, two
`ConditionalHandle`s, and — per `03-API.md` §3 — two frames from one store. Does
the *source* fan out per operator, or does the UI hold a per-operator view over
one source? This decides whether `DecisionSource.at` is per-connection state.

---

## 11. What this lens hands the other two

**To the kernel lens.** Three asks, in dependency order. (a) Put `run.lastView`
on `KernelReport` — it is the moveset table and it is already computed and
already dropped. (b) Carry an `EventId` on `PendingEvent` and copy it onto the
emission's `answers` — the pairing is already measured. (c) A query port on the
running kernel for `conditional(unit, to)` that opens a speculative context and
streams its `LeverView`, with a typed refusal when the share is spent.

**To the UI lens.** Three constraints. (a) Law C2: never sum the marginal
columns; the residual is a field and it is meant to be shown. (b) Law C5: never
sort two cluster generations or two `BasisKey`s into one table; a widening
supersedes, it does not merge. (c) Law C4: one code path for live and replay, with
`Provenanced.provenance` rendered as a badge rather than as a branch.
