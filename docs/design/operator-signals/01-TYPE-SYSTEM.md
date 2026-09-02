# 01 — The signal type system: four shapes, two operators, two roles

The mandate asks for the few base types from which the whole range composes.
The answer is not the candidate list (option sets, flows, uncertainty,
commitments, alarms, curves, asks — seven kinds); it is a factoring of that
list. Three of the seven are not base types at all.

## 1. The derivation: signals follow the machine's own kinds

A signal is a value the engine computed, presented to a human. Every value
in this architecture is fibered over a premise (the one index, prior-art
29). So a signal is: **a payload shape + a premise ref + an anchor +
a presentation**. The payload shapes are not free design choices — they are
the native outputs of the machine's kinds:

| machine kind | native output | signal shape |
|---|---|---|
| REDUCTION (set-valued) | a set of (option, dominance condition) | **SET** |
| VALUE | per-unit flow contributions in the weight currency | **FLOW** |
| MODEL / belief | (S, w): support + weight per hidden coordinate | **WIDTH** |
| ECONOMY / commitments | things held with invalidation conditions | **HELD** |

That is the whole base. Everything else in the candidate list is derived:

| candidate | is actually |
|---|---|
| curves | `trace(σ, axis)` — a base signal sampled along a resource or time axis |
| alarms | `edge(σ, predicate)` — a discrete transition of a base signal crossing a predicate |
| asks | a **role**, not a shape — any signal can be an offer or an ask (§4) |
| contrastive foils | a **projection of SET** — (fact, foil, separating condition) is what any two members of the set plus the deciding rung read off as (§2.1) |
| threat maps | an **aggregation of FLOW/WIDTH along the cell anchor** (doc 02) |
| digests | an **aggregation of edges along a cursor** (doc 02) |

So: **4 shapes × 2 operators (trace, edge) × 2 roles (offer, ask)**, plus an
aggregation algebra (doc 02) that combines them without minting new shapes.
The claim to falsify: any engine-generated signal someone wants on this
surface is expressible as `role(op*(shape))` for some composition. The
inventory in doc 00 passes; a counter-example would force a fifth shape and
should be brought loudly.

## 2. The four shapes, precisely

Common envelope (complete internally — M27's first half):

```ts
interface Signal<Shape> {
  readonly ref: SignalRef            // stable id; names find, hashes validate (Law I)
  readonly shape: 'set' | 'flow' | 'width' | 'held'
  readonly anchor: Anchor            // what it is about: game | turn | unit | cells | plan | account | member
  readonly premise: PremiseRef       // the one index: comparability, provenance, fit caveats
  readonly asOf: Freshness           // (turn, seq, quantaSpent, stagedPlanHash) — doc 03 §5
  readonly payload: Shape
}
```

### 2.1 SET — the option landscape

```ts
interface SetPayload {
  readonly options: ReadonlyArray<{
    readonly plan: PlanRef
    readonly floor: WeightUnits                    // proved, basis-tagged via premise
    readonly dominance: DominanceCondition | null   // when this option is the right one; null = undominated with no known separating condition yet
    readonly paidBy: ReadonlyArray<FlowRef>         // ≤ a few refs; the causal citations
    readonly playable: 'stageable' | 'requires-pin' | 'closed'  // the sacrifice warrant is requires-pin
  }>
  readonly staged: PlanRef                          // the incumbent
  readonly deciding: { rung: RungId; margin: WeightUnits } | null  // vs runner-up
}
```

Properties the consumers rely on:

- **The foil is free.** For the staged plan and any other member, the
  contrast (fact = staged, foil = member, separating condition = deciding
  rung + margin, or the member's dominance condition) is a *read*. Miller's
  (fact, foil) is not a fifth thing to compute; it is two indices into this
  set. `better()` computes the rung and margin today and throws them away.
- **Cardinality is the progress meter.** |options| shrinking over quanta is
  the legible monotone indicator ("four moves worth considering; ninety
  milliseconds later, two"); `trace(SET, quanta)` is the quality curve with
  human-readable units.
- **`playable` carries the authorization boundary.** A `requires-pin`
  member is the sacrifice warrant: priced, undominated, and outside the
  bot's own emission rights. Presenting one with role=ask is how the B5
  ADVICE member lands on this surface without any new type.
- Two suppliers, one shape (doc 04 §1): reconstructed from bank floors
  today; native from the maximality member when seated. The consumer cannot
  tell, except through the premise ref — which is the point.

### 2.2 FLOW — the causal currency

```ts
interface FlowPayload {
  readonly account: UnitRef | 'terminal'   // per-unit weight account; 'terminal' = the boundary member's channel
  readonly channel: ChannelId              // e.g. contest | sever | regicide | guidance:<targetId> | ...
  readonly side: 'inflow' | 'outflow'
  readonly rate: WeightUnitsPerTurn
  readonly horizon: Horizon
  readonly event: EventAnchor              // WHAT causes it: (units, cells, sub-step) — the causal anchor
}
```

- This is `Contribution { unit, flow, side, rate, horizon }` from the value
  lens, kept **pre-fold**. The standing law: these records survive to the
  surface; the fold is applied at the comparison, late. A cached sum is a
  statistic; the record above is a cause.
- **Operator guidance terms are flows.** The goto/near stat is a bounded
  per-move contribution to the same matrix — so the OUT echo of an IN
  guidance is simply the FLOW signal on channel `guidance:<target>`. One
  vocabulary for both surfaces, no new machinery. (Shared-vocabulary item
  #1 with `design/operator-guidance`.)
- The 'terminal' account carries the boundary member's content ("three
  turns from the cap, this trade flips sign") the day B4t lands.

### 2.3 WIDTH — what is not known

```ts
interface WidthPayload {
  readonly coordinate: HiddenCoordinate    // enemy action | hidden unit position | spawn | ...
  readonly support: SupportSummary         // cells/count/marginal cloud — S's projection
  readonly weight: WeightSummary | null    // w's projection, at earned precision; null = quantifier-only
  readonly removal: 'deduce' | 'observe' | 'ask' | 'none-this-turn'   // the reducibility tag
  readonly decisionRelevance: WeightUnits  // what collapsing it would move, at the deciding rung — the market weight, not the width
}
```

- `removal` is the "what-would-collapse-it" the mandate asks for, and it is
  the belief lens's reducibility tag verbatim — including its precise
  contract: it gates removal levers only, never hedged preparation.
- `decisionRelevance` is the time lens's market pricing (P(flip at the
  deciding rung) × E[improvement]) — **widths are ranked by what they would
  change, not by how wide they are**. A vast irrelevant cloud is quiet; a
  two-cell width that decides the staged move is loud. This single field is
  what makes the uncertainty surface intelligent rather than exhaustive.
- A WIDTH with `removal: 'ask'` and high decisionRelevance is the natural
  ask candidate (§4): the operator may simply know the answer (prior-art
  C33 — the third way to remove width).

### 2.4 HELD — what is currently committed

```ts
interface HeldPayload {
  readonly kind: 'pin' | 'carried-premise' | 'commitment' | 'hypothesis' | 'incumbent' | 'setting' | 'ask-issued'
  readonly author: 'operator' | 'bot'
  readonly assertion: string               // display form; structured ref in drill
  readonly since: TurnStamp
  readonly invalidation: InvalidationCondition   // what kills it (citation-law verdict classes)
  readonly health: 'live' | 'stale' | 'conflicting' | 'invalidated'
}
```

- The invalidation condition is the signal's honest half: a commitment
  without its invalidation condition presented alongside is an assertion the
  operator cannot supervise.
- **Operator-authored HELDs are echoed back with health.** A matchPin plays
  today with no feedback loop; "your pin is three turns old and now crosses
  a refusal" is the cheapest high-value HELD signal and needs no future
  machinery (doc 04 §4).
- The staged incumbent is the degenerate HELD that always exists — the
  interruptible type the per-turn agent maintains.

## 3. The two operators

```ts
trace(σ: SignalRef, axis: 'quanta' | 'turn' | 'wallMsIntoTurn'): Trace   // sampled points of σ's scalar projection along axis
edge(σ: SignalRef, predicate: PredicateId): Event                        // a discrete transition, with before/after and the predicate that fired
```

- **Curves are traces**: gapCurve = trace(SET.deciding.margin-family,
  quanta); shrinkage = trace(|SET.options|, quanta); the CPP is a *fitted*
  trace member with fit provenance (ruling 49 — the fitted curve enters as
  a member, never as an architectural commitment).
- **Alarms are edges**: posture shift = edge(WIDTH-regime); oracle violation
  = edge(HELD soundness commitment, invalidated); threat = edge(SET, floor
  dropped past band); conformance ack = edge(HELD operator-authored,
  incorporated). There is no Alarm type to design, version, or argue about —
  an alarm is any signal whose delivery is edge-triggered, and its payload
  is the underlying signal plus the transition. This keeps the alarm
  vocabulary open (new alarm = new predicate, no schema change) while the
  wire schema stays closed.
- Operators compose: `edge(trace(...))` = a saturation crossing ("thinking
  stopped buying anything this turn" — the CPP-saturation alarm).

## 4. The two roles

```ts
role: 'offer' | 'ask'
```

- **offer** — informative; the default. Consumes attention only.
- **ask** — the bot requests a determination. Two sub-cases, both
  expressible without new shapes:
  - *information ask*: a WIDTH with removal='ask' — "do you know where the
    queen went?" The answer arrives through the IN surface as an ordinary
    observation (conditioning S), never as a special channel.
  - *authorization ask*: a SET member with playable='requires-pin' — "this
    sacrifice prices at +4; authorize?" The answer is a pin — an existing
    IN affordance.
- An ask is **priced in operator attention** (Horvitz M29): issued only when
  its decisionRelevance clears the attention price under the selection law
  (doc 02 §3). An ask is never free and never suppressed by fiat.
- Ask answers re-enter as observations/pins through the IN surface — the
  one-way Law V is preserved: this surface still never writes into a
  staged-plan joint; the human does, through affordances that already exist.
  (Shared-vocabulary item #2 with `design/operator-guidance`: asks are
  *invitations to use IN affordances*, so the two surfaces must agree on the
  affordance vocabulary — an ask names the affordance that answers it.)

## 5. The presentation split (M27, enforced by type)

Every signal has two faces, and they are different fields, not different
verbosity levels:

```ts
interface AdviceItem {
  readonly signal: SignalRef           // complete internally: full payload, premise, drill refs
  readonly role: 'offer' | 'ask'
  readonly presentation: {
    readonly headline: string          // one sentence, causal, no statistics
    readonly foil?: { instead: PlanRef; because: string; margin: WeightUnits }
    readonly causes: ReadonlyArray<FlowRef>   // AT MOST TWO (Miller finding 2, as a type constraint)
    readonly affordance?: AffordanceId // for asks: the IN affordance that answers it
  }
}
```

The `causes.length ≤ 2` constraint is deliberate and checkable. The complete
causal account lives behind `signal` (drill-down); the presentation is the
selected face. A renderer that displays fields off the full payload in the
primary view is violating M27 in a way a review can catch, because the two
faces are separate objects.

**Statistics never headline.** R², fitted k, ε values, agreement
percentages: all live in the premise ref (drill), none in headlines.
Miller finding 3 as a lint rule on presentation templates.

## 6. What this type system refuses

- **No fifth shape without a counter-example.** In particular: no "Insight"
  or "Narrative" type. A narrative is an aggregation (doc 02), not a shape.
- **No signal without a premise ref.** An unlabeled number on the surface is
  the disease (values and premises traveling separately) recurring at the
  human boundary — the one place it can never be caught downstream, because
  the downstream is a person.
- **No alarm taxonomy.** Edges of typed signals, with predicates as members.
- **No bot-belief-about-operator in v1.** Miller finding 4 (explanations are
  social, relative to the explainee's beliefs) is real, and Belief(observer=
  operator) is the eventual mechanism (prior-art M28). v1 carries only the
  degenerate form: the sinceLook cursor — "what has this operator been
  shown" — which is the only part with an honest data source today.
- **No exchange rate.** Nothing in this type system converts attention to
  quanta. An ask's price and a meet's price are different currencies
  composed only at the obligation meet (doc 03 §4).
