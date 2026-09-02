# 00 — The factoring of operator guidance (INBOUND lens, cycle 1)

OPERATOR-GUIDANCE lens, first document. Mandate: ruling 51 (IN direction) —
factor the landscape of affordances by which human operators give the bot
realtime strategic guidance, so that guidance integrates smoothly into the
tree search. Primary source: the Snek Centaur Platform corpus
(`legacy-spec-archive/informal-spec/*` — the Drive/Preference framework,
studied closely in §1) plus this product's shipped commands (`goto`, `near`,
pins) and the sibling design branches (joints-composition, search-theory,
belief-fog, time-interruption, red-team). Grounded on `primary` @ `66904d2`.

Nothing here is final (ruling 50). Status of every claim: proposed carve,
argued from the corpus; falsifiers and open questions at the end.

---

## 1. The primary source, read closely: what the Snek Drive actually is

The platform spec defines two heuristic types:

```ts
interface Drive<T> {                    // "directed motivation toward/away
  target: T;                            //  from a future event"
  eligibleTargets(candidate, self, board): boolean;
  rewardFunc(self, target, board): number;        // [-1,1]; sign = goal/fear
  distanceFunc(self, target, board): number;      // est. turns to the event
  motivationFunc(reward, distance): number;       // dampening fold
  satisfiedPredicate(self, target, board): boolean; // completion event
  nominateSelfDirections(...): Direction[];       // priority-ordered
  nominateForeignMoves(...): {snakeId, direction}[];
}
type Preference = (self, board) => number;        // [-1,1], no target
```

plus a portfolio weight per active instance, the single calibration surface.
Drives are operator-added at runtime with a click-target UI; Preferences are
on-by-default fields. The framework's own claim: goal vs fear "is purely
semantic — the framework treats all Drives identically."

**Reading 1 — the Drive is a bundle of three different things.** Trace where
each field lands in the platform's own machinery:

| Drive field | consumed by | what it actually is |
|---|---|---|
| `rewardFunc`/`distanceFunc`/`motivationFunc` × weight | world scoring (§6.7) | a **value term** — a field over simulated states |
| `nominateSelfDirections`, `nominateForeignMoves` | interest map, Dijkstra-on-lattice priority (§6.6) | an **attention/support term** — which worlds get simulated at all, and in what order |
| `satisfiedPredicate` + removal-after-satisfaction | portfolio lifecycle (§6.1) | a **lifecycle rule** — when the directive dies |
| `target` + `eligibleTargets` | the targeting UI and all of the above | a **field constructor parameter** — the referent the other three are generated from |

Four orthogonal concerns fused in one interface. The fusion is what makes the
drives/preferences split look fundamental: a Preference is just the bundle
with three of the four slots empty (no target, no nominations, no lifecycle).

**Reading 2 — the nomination half is load-bearing and easily missed.** In the
platform design, `nominateForeignMoves` does not merely order work: a foreign
snake with **no** nomination from any Drive *is absent from the lattice
entirely* — held at its current position in every simulated world. Drives
therefore control the **support** of the search (which enemy replies exist),
not only its priorities. The human's guidance decides what the minimax even
ranges over. This is the strongest single idea in the platform corpus, and it
is exactly the hook our restricted-matrix machinery needs (§4.3).

**Reading 3 — the platform separates durable intent from derived data.** Snek:
"the waypoint TARGET is the durable intent state; paths and stats are derived,
recomputed from the live board." Our own `waypoint-pathing.ts` states the same
rule verbatim. Portfolio-weight edits are cheap by design (rescan cached
normalized outputs; no re-simulation); structural edits (add/remove/retarget a
Drive) toggle cached branches active/dormant and queue new ones. This is a
convergent, twice-invented design and we should treat it as settled: **targets
and magnitudes are state; fields, routes and stats are derived**; magnitude
edits re-fold at read, structural edits invalidate by citation.

**Reading 4 — the owner's seed case, confirmed in the shipped code.** `goto`
and `near` (`active-game-manager.ts`, `waypoint-pathing.ts`,
`heuristics.ts`) differ in exactly two coordinates and agree in every other:

| | `goto` (green) | `near` (blue) |
|---|---|---|
| referent | cell (queue of cells) | cell |
| field | ramp peaking on arrival (`gotoProgressStat`: optimal step ⇒ 1) | ramp peaking at distance 1, **zero on the target** |
| lifecycle | until-arrival; arrival shifts the queue; empty queue reverts to heuristic | indefinite — "never auto-clears" |
| authority | biases the matrix, bounded below the death band | same |
| magnitude | weight 300 default | weight 250 default |

So "has a target" does not separate them (both do), and "is a goal" does not
separate them (both are). What separates them is **lifecycle** (completion
event vs none) and **field shape** (two different ramps off the same BFS
distance). The drives/preferences carve puts them in one bucket and
preferences in another; the real joints run *through* the Drive object.

---

## 2. The factoring: five coordinates

**Claim.** Every operator-guidance affordance — shipped, planned by the
platform, or new — is a point in a five-coordinate space. A guidance
utterance is a record; the coordinates are its fields; the search consumes
each coordinate through machinery the sibling lenses already specified.

```
GuidanceUtterance =
  ⟨ PORT        — what the search consumes (the payload's type)         §2.1
  , SCOPE       — whose behaviour it colours                            §2.2
  , CONSTRUCTOR — how the payload is generated (referent → field)       §2.3
  , LIFECYCLE   — how long it lives, what kills it                      §2.4
  , AUTHORITY   — how much of the machine it may override               §2.5
  ⟩
```

Two of the owner's candidate axes are deliberately **not** top-level:

- **has-target** dissolves into CONSTRUCTOR: a target is not a category of
  guidance but a *parameter of a field generator*. `goto`'s field is
  `distance-ramp(target)`; a Preference's field is hand-written; a region
  directive's field is `presence(region)`. "Drive vs Preference" =
  "generated field vs literal field", which is an authoring distinction,
  not a semantic one.
- **has-completion-event** dissolves into LIFECYCLE: `satisfiedPredicate` is
  the `until` predicate of a carried premise (§2.4). Discrete satisfaction
  vs continuous score is a property of the *lifetime*, not of the value.
- **sign** (goal vs fear) is not an axis at all in this architecture — but
  not for the platform's reason. See §3: under a worst-case reduction the
  goal/fear symmetry breaks, and fears land mostly in a *different port*
  than goals. Sign survives as the sign of a magnitude within one port.

### 2.1 PORT — where the payload enters the search

Seven ports, each owned by a joint the sibling lenses already carved. This is
the integration axis: naming the port names the entry point, the law that
governs it, and the invalidation rule.

| port | payload | consuming joint | governing law |
|---|---|---|---|
| **value-field** | `f: State → [0,1]` × weight | ACTION order / advised channel | bounded term, below the death band; premise-tagged; never the sound bound (Law C2) |
| **attention-field** | bounty over (units, cells, plans) | METALEVEL market + PROPOSAL | spends compute only; metered; cannot starve the kernel's first rung |
| **support-demand** | named enemy options / unit that must be priced | MODEL support / restricted matrix | **widen-only** (§3); sound-safe by the floor theorem |
| **appetite** | risk posture (utility curvature) | REDUCTION read sites | belief lens's one fear dial, scoped; applied once at the read |
| **deadline** | tempo directive / commit policy | ECONOMY obligation lattice | composes by MIN; humans-always-win stays the bottom element |
| **license** | scoped exception to a named closure | ACTION admission | the F1 priced-exception path; explicit, scoped, logged, owner-gated |
| **determination** | the move itself (pin/manual/commit) | the wire | `observe(determination)`; lifetime ≤ turn; bot never auto-unpins |

A single operator gesture may compile to payloads on several ports (a Snek
Drive compiles to value-field + attention-field + support-demand, §1), but
each payload has exactly one port, and the ports never share a law.

### 2.2 SCOPE — whose behaviour it colours

`unit | coalition (unit set) | team | game`. Notes:

- Scope ≠ referent. "Unit A: kill enemy X" has scope = A, referent = X.
  "Everyone avoid the north" has scope = team, referent = region.
- The VALUE manifest already carries this axis: members declare a
  **participant scope**. A team-scoped value-field is a VALUE contribution at
  team scope; a unit-scoped one at unit scope. No new column.
- Enemy-directed guidance ("watch the queen") is scope = team with an
  enemy-unit referent — scope stays *ours*; the enemy appears only as
  referent. Nothing operator-facing ever scopes an enemy's behaviour.

### 2.3 CONSTRUCTOR — how the payload is generated

The generative axis. A payload is either **literal** (a hand-authored member:
today's Preferences, the seated evaluator terms) or **constructed** by a
kernel generator from a referent:

| referent | example constructors |
|---|---|
| cell | distance-ramp (goto), proximity-ramp (near), avoidance-ramp (negated) |
| region (cell set) | presence/territory-share field; containment closure candidate |
| unit (ours or enemy) | pursuit/escort ramp (moving target — field re-derived per turn); threat-attention |
| event predicate | "reach length n", "any potion collected", "turn ≥ k" — fields and lifecycle predicates over non-spatial state |
| none | literal field (Preference) |

Constructors are kernel code; referents are data. This is what keeps Law N
(config is data) intact while making the guidance space large: the UI ships a
dropdown of constructors × a targeting mode per referent type — exactly the
platform's `eligibleTargets` + Tab-cycling UI, which carries over unchanged.

One BFS serves every spatial constructor (the shipped `waypointRoute` walks
per-unit search spaces — rays, jumps, turn-then-step — without knowing which);
one field table per decision crosses into the workers (the shipped
`computeWaypointProgressByMove` pattern).

### 2.4 LIFECYCLE — the Carried object, natively

The composition lens's carried premise (`05-ADVANCE-AND-COMMITMENTS.md`) is
the exact host. A guidance utterance IS a `Carried` with `author: 'operator'`:

```ts
lifetime: { kind: 'decision' }              // tentative pin (speculation only)
        | { kind: 'turn' }                  // manual pin, per-turn commit advice
        | { kind: 'turns'; n }              // "for the next 5 turns"
        | { kind: 'until'; predicate }      // goto (arrived), Drive (satisfied),
                                            //   role/stance (predicate)
        | { kind: 'standing' }              // near, preferences — NEW, see §6.2
invalidate: MemberId                        // target died, target unreachable,
                                            //   operator removed, ratified-over
```

The owner's hypothesis is confirmed: **drives are carried premises** —
`satisfiedPredicate` is the `until` predicate, satisfaction-removal is the
lifetime expiring, target-death is the invalidation member, and the
interruption theorem (Law C2 + the unconditioned sound channel running
beside) is what makes an operator directive cheap to abandon and structurally
unable to walk a unit into a proved death. The `goto` queue is a chain of
Carrieds where each `until` spawns the successor. What Carried needs from us
is one small amendment (`standing`, §6.2) — everything else is native.

Lifecycle also fixes the edit semantics for free, by the laws the time lens
already wrote: a guidance edit is a **determination on the guidance config
coordinate**. Magnitude-only edits re-fold at read (Law B's blend-at-read
analogue — the platform's own "weight changes rescan cached outputs" rule);
structural edits (add/remove/retarget) kill exactly the fibers labeled with
the old guidance state (Law C1 conditional labeling + citation-scoped
invalidation + cutoff), and demote softly at the next tranche like a dial
change. The Snek platform's entire reactive active/dormant branch machinery
is this, hand-built; we get it from the worldline design.

### 2.5 AUTHORITY — the five-rung ladder

The owner's question: does operator guidance ever get more authority than the
standing law's "order and spend, never a bound or refusal"? Answer: **yes —
three well-defined rungs above, each narrow, each already precedented**, and
the ladder trades authority against either scope or duration at every step:

| rung | may change | precedent | its limit |
|---|---|---|---|
| **A0 attention** | spend only | tentative pins ("the search may speculate; never binding"); selection/hover compute priority (Snek §6.10, ours) | cannot move even an ordering |
| **A1 bias** | order + spend | Law C2 verbatim; goto/near weights; portfolio weights; appetite | bounded below the death band; advised channel only |
| **A2 widen** | the sound floor, **in the pessimistic direction only** | support-demand: adding enemy rows to the priced support lowers floors *honestly* (floors over S floor any S′ ⊆ S — the belief lens's fill) | may never narrow S, never raise a floor, never touch a refusal |
| **A3 license** | one named closure, scoped | F1's priced-exception path; the sacrifice warrant's "a pin makes it play" generalized to a standing grant | names the closure, the scope, the condition; logged; **owner decision required** (B5) |
| **A4 determine** | the move itself | manual pin, waypoint step, Submit All; `matchPin` resolves against the pruned ledger, so a human already plays what the closure refused | **lifetime ≤ one turn**; the bot never auto-unpins; humans always win |

Two theorems-by-construction fall out of the ladder:

- **Durability caps authority.** A4 lives at most a turn (pins die at the
  turn boundary — shipped behaviour). Anything an operator wants to persist
  must descend to A3 or below, i.e. become a premise the sound channel runs
  beside. There is no such thing as a standing manual move.
- **Optimism requires a name.** The only rungs that can make the bot *less*
  careful are A3 and A4 — and both are explicit, scoped, logged acts. A1/A2
  can redirect it and make it more careful, never less. This is ruling 13's
  division of labour (humans take the risks) as a type discipline.

---

## 3. Sign is not symmetric here: where goals and fears actually land

The platform says goal/fear "is purely semantic". Under its reduction — a
worst case taken over *only the nominated* foreign moves — that is true.
Under ours it is false, and the asymmetry is the single most important thing
this lens has to say about integration:

**Our bot is already maximally fearful.** Γ-maximin with adversarial support:
every threat *inside the priced support* is already priced at full weight. A
fear payload delivered as a negative value term ("penalize being near the
queen") double-counts what the min already counts — the known
double-discount shape.

What a human fear is *actually worth* in a worst-case machine, in order:

1. **Getting the threat INTO the priced support** (support-demand, A2). The
   restricted-matrix result: five of nine probe boards produce no columns at
   all because the gate admits only contacting held units. A human who sees
   a developing threat from board shape is saying *"the queen is a contestant
   here even though geometry hasn't triggered the gate"* — one named unit
   added to the restriction, the floor drops honestly, the bot routes around
   what it previously could not see. This is the Snek insight (nominations
   define the lattice) landing on our machinery.
2. **Funding verification** (attention-field, A0): threads and deep work on
   the feared line — "verify computationally and find avoidance paths" is
   the platform's own definition of a fear, and it names compute, not value.
3. Only third, and rarely: a value term (A1) for *graded* aversions that are
   genuinely preferences, not threats ("stay off hazard rows when cheap").

Goals invert the ranking: mostly value-field + attention-field (A1 + A0),
with support-demand only when the goal involves enemy reaction.

Consequence for the wire: the `fear` UI verb compiles to
`support-demand + attention (+ optional small negative field)`; the `goal`
verb to `value-field + attention (+ optional support-demand)`. Same record
shape, different default port mix. Sign survives as UI vocabulary and as the
sign of the A1 magnitude; it is not an architectural axis.

*(Mismatch M1, for the platform corpus: the "purely semantic" claim does not
survive a sound-floor architecture; a port-blind fear implementation would
ship double-counting. §6 records it.)*

---

## 4. Every required affordance as a point (the expressiveness test)

Ruling 51's list, plus the red team's, plus genuinely new ones. Format:
⟨PORT(s) | SCOPE | CONSTRUCTOR | LIFECYCLE | AUTHORITY⟩.

| affordance | coordinates |
|---|---|
| **goto** (shipped) | ⟨value-field + attention | unit | cell, distance-ramp | until(arrived), queue-chained | A1⟩ |
| **near** (shipped) | ⟨value-field + attention | unit | cell, proximity-ramp | standing | A1⟩ |
| **manual pin** (shipped) | ⟨determination | unit | — | turn | A4⟩ |
| **tentative pin / hover** (shipped) | ⟨attention | unit | — | decision | A0⟩ |
| Snek **Drive** (platform) | ⟨value-field + attention + support-demand | unit | unit-or-cell constructor | until(satisfied) | A1(+A2)⟩ |
| Snek **Preference** (platform) | ⟨value-field | unit or team | none (literal member) | standing | A1⟩ |
| Snek **fear** (platform) | ⟨support-demand + attention | unit | unit/region/event | until or standing | A2 + A0⟩ |
| **sacrifice authorization** (F1, per-instance) | ⟨determination | unit | — | turn | A4⟩ — a pin on a warrant surfaced by ADVICE |
| **sacrifice standing grant** (F1, Option-B-lite) | ⟨license | unit or team | event predicate (warrant > θ) | turns(n) or until | A3⟩ |
| **commit-timing directive** (F3b) | ⟨deadline | team | event predicate | turn or standing | A1-on-obligation (MIN keeps the kernel row)⟩ |
| **region to hold** (new) | ⟨value-field(presence) + attention | coalition | region | until(released) | A1⟩ |
| **region to avoid** (new) | ⟨value-field(negated presence) | unit/team | region | standing | A1⟩ — the A3 hard form exists but must be licensed |
| **escort / stay-near ally** (new) | ⟨value-field | unit | unit, proximity-ramp | until(ally dies) | A1⟩ — `near` with a moving referent |
| **target priority** (new) | magnitude vector over active A1 payloads — not a new point, a re-weighting of existing ones |
| **risk posture per unit** (new) | ⟨appetite | unit | none | standing | A1⟩ — the belief lens's appetite dial, scope-indexed (§6.4) |
| **tempo directive** ("take your time" / "blitz") | ⟨deadline | team | none | standing | A1-on-obligation⟩ |
| **watch this** (pure attention) | ⟨attention | team | any referent | turns(n) | A0⟩ — guidance with zero behavioural authority, pure compute steering |
| **"the queen is in play"** | ⟨support-demand | team | unit | standing | A2⟩ — one named unit into the restriction gate |
| **what-if quote** ("if my knight goes east?") | ⟨attention | unit | hypothetical option | decision | A0⟩ — the tentative pin generalized; ephemeral channel, never a table row (06-doc §2; closes the OUT lens's confirmed hole) |

Every row lands without new machinery beyond the five coordinates and the
per-port entry points that sibling branches already specified. The rows that
need *decisions* rather than machinery: A3 rows (owner-gated, B5) and the
`standing` lifetime (one-line Carried amendment).

**What is deliberately NOT expressible** (negative space, matching the
corpus's refusals): a standing determination (A4 > turn); an operator
narrowing of enemy support ("he won't go left" — that is a weight-supplier
opinion for the advised channel, D2-gated by ruling 13, never a support
edit); an operator-raised floor; any guidance the staged-plan path reads from
ADVICE output without a human act in between (§5.4).

---

## 5. Integration: what each port touches, precisely

### 5.1 value-field → the ordering, the advised channel, never the fold's floor

Enter exactly where `gotoProgress`/`nearProgress` enter today: a bounded stat
in [0,1] × a declared weight, summed into the ordering beside the evaluator
terms, premise-tagged with the guidance config coordinate. Three rules:

- **The guidance budget is enforced, not conventional.** Today's safety
  argument ("keep both below the death penalties") is a comment. Under the
  generated knob schema it becomes a validation rule on the guidance doc:
  Σ|operator A1 weights| < min(|death band|, |trapped|) at config-accept
  time. The wire refuses a guidance doc that could buy a death.
- **Common-currency honesty.** Operator fields are not weight-share flows;
  they enter the *ordering* and the *advised* reading, never `estSound`,
  never a bound (Law C2). Under the value lens's three-flow fold they are a
  fourth, operator-denominated term that the scalarization declares — the
  fold's own residual/provenance discipline applies.
- **Participant scope declared.** A team-scoped field contributes at team
  scope in the fold, so "hold the region" prices coalition trades correctly
  rather than per-unit.

### 5.2 attention-field → the metalevel market and the proposal stage

Two entry points, both already specified by siblings:

- **Market bounty.** The time lens prices meets by
  P(realize) × P(flip) × E[improvement]. An attention payload adds a bounty
  term on work whose footprint intersects the referent (threads rooted on
  the feared unit; cluster joints containing the region). Metered by the
  metareasoning meter; the two-currencies law is untouched — a human
  *directing* compute is not the scheduler *spending* the human.
- **Proposal operator.** Guidance-directed proposals register at the
  lifecycle's `admit@A2` like the other eight operators, with a
  `cost(state)` — plans that move toward the target enter the priced set
  even when the incumbent ordering would never generate them. This also
  fixes the A1-cap blindness exhibit: the value lens showed the slider cap
  discards value the comparator *cannot name*; an operator nomination is
  precisely a namable positional term arriving from outside the comparator.

### 5.3 support-demand → the restriction gate and the bank's rungs

One named enemy unit (or line) added to the restricted matrix's contestant
set / the priced support at the relevant rungs. Sound by the widening
theorem; the reduction, ordering, and floors all update through existing
paths. The gate change is small because the gate is already data (which held
units are admitted as contestants); the guidance row is one more source
feeding it, tagged with provenance so botDiff shows it.

### 5.4 The out-half handshake (ADVICE ↔ guidance), and one law gap

The OUT direction is the ADVICE kind — not this lens's mandate — but the two
halves meet at a seam that needs one rule. Warrants, disagreement signals and
commit-timing advice carry artifact ids; a guidance utterance may cite the id
it responds to (`provokedBy`). That closes the loop for provenance and
telemetry (which advice gets acted on — the uptake number the program has
never had) without violating ADVICE's one-way law: the staged-plan path still
never reads ADVICE output; a *human act* is always between.

The gap: **ratification laundering**. If the UI lets the bot propose a drive
and the operator accept it in one click, an A1/A2/A3 payload is
operator-authored only nominally. The Carried record therefore carries
`provokedBy` and the distinction `authored | ratified`; anything ratified
keeps bot-grade provenance for measurement purposes (its fitted terms stay
subject to Law F1/F2), and A3 licenses may not be ratified-in-one-click at
all. Without this, the one-way constraint is real in code and dead in
practice.

### 5.5 Lifecycle → ingestion and the turn boundary

Completion predicates run at board ingestion, where the goto-arrival shift
already runs (`firebase-interface.ts` — canonical board fed once, arrivals
shift queues, re-stage against the new turn). ADVANCE carries guidance
attention and the premise; values re-walk. Bot-authored carries revalidate
every turn or die (time lens law); operator-authored carries persist until
their own lifecycle says otherwise — the asymmetry is deliberate and is the
shipped `near`-never-auto-clears behaviour, generalized.

---

## 6. Named mismatches and amendments owed (cycle-1 list)

**M1 — platform corpus.** "Goal vs fear is purely semantic" is false under a
sound-floor reduction (§3). A port-blind port of the Drive interface would
double-count fears. The Drive object should be compiled, not ported: one
authoring gesture → payloads on up to three ports.

**M2 — composition lens, small.** `Carried.lifetime` lacks a `standing` kind
(no predicate, dies only by operator removal or invalidation). `near` and
every Preference need it. `{until: never}` abuses the predicate slot; a named
kind keeps the revalidation law ("bot-authored carries revalidate or die")
cleanly scoped to bot authors.

**M3 — belief lens.** The 11-doc dissolution leaves the operator "a single
legible appetite dial". Ruling 51's per-unit risk posture needs that dial
**scope-indexed** (team default, unit override) — same member, a scope
parameter, read per site-class. The "one dial" simplification should be
restated as "one dial *kind*".

**M4 — joints lens / ADVICE.** The one-way law needs the ratification rider
(§5.4): `authored | ratified` provenance on operator payloads, plus
no-one-click-ratification for A3. Otherwise reachability-of-influence is
laundered through the UI.

**M5 — search lens.** The lifecycle ledger's `set_aside` dispositions are
exactly what a **guidance-frustration signal** needs ("why is the bot not
doing what I asked": nominated plan refused at A1/A2/A3, outvoted in the
ordering, or beaten at the reduction — three different answers with three
different remedies, all reads of the ledger + the ordering's premise tags).
Not a mismatch — a consumer the ledger design didn't know it had; worth a
row in their doc-10 consumer table. It generalizes `advice/disagreement`.

**M6 — time lens.** The durability strata that `observe(determination)`
consults must include the guidance config coordinates (magnitude vs
structural split per §2.4), and the reaction table gains rows for
operator-deadline payloads. Their "ask the operator" economy row is the
OUT-direction twin of the deadline port and should share its schema.

**M7 — value lens.** The fold needs a declared stance on the
operator-denominated term (§5.1): fourth flow with its own denomination, or
ordering-only. Recommendation: ordering-only until a fitted exchange into
weight-share exists — and that exchange, if ever fitted, is a member with
provenance, not a constant.

**M8 — platform corpus, doctrinal (found cycle 3).** The platform's interest
map is not merely compute-ordering: a simulated world **counts for scoring
iff every foreign move it assumes was nominated by some active Drive**
(bot-framework spec, reactive-inputs requirement). Its worst case is taken
over a *human-curated support, narrowed from nothing* — an unnominated
threat is invisible to the min. Ours is the polar opposite: adversarial
support by default, operator demands *widen from everything* (A2's
widen-only law). Under ruling 13 ours is the sound polarity; the platform
design makes the human responsible for the completeness of the fear set,
and a silent port of its nomination semantics onto our engine would convert
guidance from sound-safe to soundness-destroying. The affordance carries
over; the polarity must invert. (The platform's own lattice priority
weights are the A0 half and port cleanly.)

**M10 — operator-signals lens, co-owned contract (06-doc).** The echo
theorem's IN-side half: each port's compile step owes per-decision
retention under the utterance id (the echo is a read). Port contracts are
not done without it; the retention table lives in 06 §1.

**M9 — platform corpus, adopted INTO our carve.** The current-generation
spec refines Drive retirement: *re-derived from each turn's observed board,
never latched* — a satisfied Drive returns when its predicate stops
holding. That is a **maintenance** lifecycle (dormant while satisfied,
alive when violated), distinct from `goto`'s latched one-shot arrival, and
it is the natural semantics for "hold this region" / "escort". Adopted:
`lifecycle.until` carries `latched | maintenance` (02-doc §1). The
restart-statelessness discipline (re-derive from the authoritative board)
comes with it.

---

## 7. The wire, in one paragraph (full sketch in 02)

One **guidance document** per (game, team), realtime-synced (Firestore today,
the platform's team Convex later — the shapes are isomorphic to its
`snake_drives` table plus our `SnakeIntent`): a list of utterance records
⟨id, author, provokedBy?, scope, payload{port, constructor, referent,
magnitude}, lifecycle, authority⟩, validated against a **generated schema**
(the joints lens's knob schema, extended with constructor rows) — Law N
holds: constructors and predicates are member ids, referents and magnitudes
are data, no expressions. Every accepted edit stamps a new guidance config
coordinate (a new address — the joints "dial excursion" path), which is what
makes botDiff, replay, and measurement of operator influence free. The
per-turn command snapshot (`CommandTurnState`) extends to persist the active
utterance set, so replays show *what was asked* beside what was played.

---

## 8. Falsifiers and open questions

Falsifiers for the carve itself (no behaviour change needed):

1. **Subsumption test**: express `goto`, `near`, and both Snek heuristic
   types as utterance records and re-derive their shipped/spec'd behaviour
   from port semantics alone. Any needed special case falsifies the carve.
2. **The Drive-unbundling test**: implement one platform Drive (Kill(target))
   as compiled payloads; measure double-counting with fear-as-value vs
   fear-as-support on seeded threat boards (the §3 claim, made empirical).
3. **Frustration-signal test** (M5): on boards where a goto target is
   refused, the ledger must name the refusing stage; if it cannot, the
   port/ledger integration is under-specified.

Open questions (mine, not the owner's, unless marked):

- **Q1 (owner, with B5)**: does the A3 license rung exist at launch, or is
  A4-per-instance (pin each sacrifice) enough for the first Centaur games?
  Everything else here works with A3 absent.
- **Q2**: does a region-hold value-field at team scope need its own
  constructor family (territory-share vs presence-count), and which is the
  seated default? Cheap to defer — both are literal members behind one
  referent type.
- **Q3**: attention-field bounty units — additive bonus vs multiplier on the
  market weight. The metareasoning meter bounds either; pick by measurement.
- **Q4**: guidance persistence across games (a team's standing preferences =
  the platform's global heuristic config) — config-time defaults vs in-game
  utterances share the schema; where is the split stored in our product?
