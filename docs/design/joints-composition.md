# JOINTS & COMPOSITION — one joint space, one address space

**Lens.** The joint system itself: configuration, registries, the engine API, and
how strategy collections compose. Not "which heuristics" — *what a joint is, what
a member is, how members combine, and how a configured bot becomes a value you
can hash, diff, measure and re-enter.*

**Status.** Design, cycle 1. Branch `design/joints-composition`, worktree only.
Anchors verified against `claude/cluster-lookahead` @ `3090b77`
(`$SP/cl-main`), the kit line @ `639416b`, and `TacticToes` @ `416d9c8`.

---

## 0. The claim in one paragraph

The program has, three times now, paid for the same defect in three costumes:
a strategy that was *selectable and inert* (`potion-aware` played by the shipped
evaluator for its entire measured life), a switch that was *set and overridden*
(`X ?? XEnabled()` at every call site, per-engine override beating the
environment), and an instrument that *read a name nothing published*
(`mechanism.cluster` against a folded replay row, reporting a live layer dead).
These are not three bugs. They are one bug: **a value and the premise it was
computed under travel separately, so two things that are not comparable get
compared and nobody is told.** The bounds layer already solved this locally —
`ScoreBounds.assumptions`, cross-basis refusal, `evaluationIdentity` as a memo
namespace — and every place the discipline stops is where the program lost
weeks. The factorization below is that discipline promoted to the spine:
**every value carries its premise; every joint is a typed collection with a
declared composition law; a bot is an expression over those collections that
normalises to a canonical point with an address; and nothing that is not
reachable from a named bot may exist in the tree.** The owner's five sockets,
the eight D-joints of the DoF synthesis, the Centaur knob surface, the
experiment arm and the search-map re-entry the owner asked for all fall out as
instances rather than as separate machinery.

---

## 1. What exists, read precisely

Six vocabularies express bot configuration today, and they overlap:

| # | vocabulary | where | identity | who validates |
|---|---|---|---|---|
| 1 | `CriterionProfile` (weights + 4 structured knobs) | `evaluate/calibration.ts` | `structuralIdentity` via `evaluationIdentity` | nothing — it arrives as a *constructed object* |
| 2 | `Slate` (entry ids per socket) | `registry.ts` | `entryFingerprint` per entry | `StrategyRegistry.resolve` (total, throws) |
| 3 | `BotConfig` (flat fields + 3 nested partials) | `bot-config.ts` | none | `botConfigFromJson` (hand-written key set) |
| 4 | `TeamDecisionOptions` (`slate`, `evaluate`, speculation, pool, seams) | `team-decision-engine.ts` | none | none |
| 5 | entry `params` (JsonValue, by-reference to shipped constants) | `registry.ts` | in the fingerprint | `registry.test.ts` pins |
| 6 | arm string `name=bundle,bot@seat=json,KEY=V` + spec JSON | kit `run-pair.js` / `lib/arm-spec.js` | arm name + bundle path | `arm-spec.js` (refuses ambiguity) |

And the *record* of what ran is re-projected by hand into `BotStamp`,
`SlateStamp`, `MechanismReport.*`, manifest columns and ledger rows.

Three structural consequences, each already paid for:

**(a) The joint list is enumerated five times.** `SlotId`; `BotConfig`'s fields;
`botConfigFromJson`'s `known` set; `BotStamp`'s hand-written rows; the kit's
manifest columns. Adding a joint means five edits and a docs pass; forgetting
one is silent. `MechanismReport.loop` had to be *added later* precisely because
"improveCalls is the upstream cause of cluster/scout/focus, and its absence is
why nobody could tell 'the layer refused' from 'the layer was never asked'."

**(b) Two channels for one joint, composed by `??`.** `this.options.slate ??
this.bot.slate` still stands (two sources for the socket selection).
`this.options.evaluate ?? evaluatorForSlate(...)` was the same shape and it cost
the program *every potion measurement it had ever taken*. The repair
(profile is the base, lineup composes onto it) is correct and is exactly the
right lesson generalised: **`??` between two config channels is not a default,
it is a silent winner-takes-all over a joint.** There is no lint against the
next one.

**(c) A slate is a hand-written record, so variation is copy.**
`potion-aware-bold` differs from `potion-aware` in four numbers and is a whole
second slate, four new entry ids, a second weights table, and a fourth branch in
`slateFor`. `SlateId` is a closed union; `slateFor` is a switch. The
combinatorics are hostile: N joints × M members needs a named slate per point,
and the *difference between two arms* — the thing a verdict is about — exists
only in prose.

**(d) `BotConfig` is where flags went to hide.** Not the concept — the concept
is exactly right and the teardown was the program's best structural work. But
`territoryRefine: false`, `multistartSeed: false`, `sampledCap: false`,
`search.clusterEnum: undefined` are *unversioned, unrecorded, unfingerprinted
members with no priors, no cost model and no empirical record*, selected by
nobody, whose code ships. That is the same disease under a healthier name: a
`false` default with no bot in the roster that sets it true is a code path with
no player. The registry has the cure already (identity, record, seam rule) and
does not apply it to these.

---

## 2. The deep joint: values are fibered over premises

> **Law P (premise fibration).** Every quantity the bot computes is a pair
> `⟨value, premise⟩`. Premises form a lattice ordered by *strength* (more
> assumed = stronger). Two values may be compared only inside one fiber.
> Combining values across fibers requires an explicit **join** (widen both to
> the weakest common premise, which is sound and loses information) or is a
> typed refusal. No operation may silently unify fibers.

A premise is exactly what the program already keeps in pieces:

```
Premise = {
  model:      which units are simulated vs held-with-cloud, at which observed turns
  replies:    which enemy joint actions are quantified over (∀ / a modelled set / a witness)
  horizon:    the ply and the turn-limit regime
  frame:      which evaluator terms are computed vs pending (their spans)
  pins:       the operator commitments held fixed
  config:     the bot address (§4) — the terms, weights, rules that produced it
}
```

Everything the architecture argues about turns out to be an operation on this
lattice, and today each is implemented separately:

| phenomenon | as premise arithmetic |
|---|---|
| cross-basis refusal | comparison across fibers, refused |
| shadow / pending envelope | a value at a *weaker frame*, widened to compare |
| a deep finding at ply k | a value at a *different horizon*; not comparable by magnitude, hence precision weighting |
| possibility clouds (fog) | a *weaker model* premise; conservative reading = join |
| staleness (`turnsHeld` vs `currentTurn − observedTurn`) | two encodings of one premise coordinate — mixing them "silently DOUBLES head-start compensation" |
| `evaluationIdentity` memo namespace | a *config* premise coordinate used as a cache key |
| worker protocol divergence | same key, different fiber |
| A/A floor in the harness | the width of the measurement's own premise noise |
| the potion-aware inertness | reported premise ≠ actual premise, with no check |

The payoff of naming it once: **the same refusal machinery that keeps floors
sound also keeps measurements honest and caches correct.** A row in a manifest,
a memo key, a bound comparison and an experiment arm are all fiber-tagged
values, and one law covers them.

Two engineering commitments make it real rather than a metaphor:

1. **Premise is a value with a canonical address.** `premiseId =
   structuralIdentity(premise)` (the function exists, `contracts.ts:83`). Cheap:
   `evaluationIdentity` already proves the cost is affordable on the hot path
   when the stable half is precomputed once.
2. **Joins are total and explicit.** `join(p, q)` returns the weakest common
   premise plus the *widening record* (what was given up). A widening record is
   what `Assumption` already is; it becomes uniform and it becomes carried
   everywhere, not only on `ScoreBounds`.

This is also the answer to the owner's search-map re-entry ask (2026-08, "we
want to be able to instantly recover where we left off ... if the state pinned
by human decisions returns to one that we had already done lots of
computation on"): a search result addressed by `⟨board, premise⟩` is *by
construction* re-enterable, because the pin set is a premise coordinate. Today
the decision's work is per-turn scratch keyed by nothing; under Law P the map is
a cache over an address space that pins move around inside.

---

## 3. Joints as data: one manifest, typed collections, declared composition

### 3.1 A joint is a row, not a type declaration

```ts
interface Joint<M> {
  readonly id: JointId                 // 'value/terms', 'order/logits', 'economy/schedule', …
  readonly kind: JointKind             // §3.3 — decides the composition law
  readonly member: Codec<M>            // parse/validate/serialise ONE member's params
  readonly compose: (ms: readonly M[]) => M       // the joint's own law (§3.3)
  readonly unit: M                     // identity of `compose` — "this joint, unselected"
  readonly laws?: LawHarness<M>        // admission gate for sound-writing joints
  readonly engagement: (r: DecisionTrace) => number   // how a member proves it ran
}
export const JOINTS: readonly Joint<any>[] = [ … ]   // THE joint list, once
```

Everything downstream is *derived* from `JOINTS`: the config codec (no
hand-written `known` set), the stamp (no hand-written `BotStamp`), the manifest
columns, the diff, the docs table, and the reachability check (§5). Adding a
joint is one row plus its interpreter. Deleting a joint is deleting one row, and
CI proves nothing references it — which is what makes lane-(b) architecture
branches cheap to compare: **two branches differ by a diffable joint manifest**,
not by scattered edits across five enumerations.

### 3.2 A member is the existing `StrategyEntry`, generalised

`StrategyEntry` (id, params, primitive, soundness, priors, cost, record) is the
right shape and should absorb the `BotConfig` fields that are secretly members:
`territoryRefine`, `multistartSeed`, `sampledCap`, `search.clusterEnum`,
`candidates.*`, `depth.*`, the criterion profiles, the staging-safety level.
Each becomes a member of its joint's collection with an id, a fingerprint and a
record — or is deleted. There is no third status.

### 3.3 Composition laws are per *kind*, and the kind is the real carving

The owner's list ("candidate move selectors / board evaluator selectors / board
evaluators / aggregation rules / turn partitioning") is indicative, and the DoF
synthesis already showed four of the five are compute machinery. The carving
that makes composition *typable* is by **what kind of thing a member is**, which
is precisely what determines how two members combine:

| kind | member is | composition law | members today |
|---|---|---|---|
| **MODEL** | a premise-producing claim about the world | **lattice join** (weakening only; a model may only be widened soundly) | forward model (kernel), possibility clouds, staleness, *enemy-action model (absent — the D2 socket)*, spawn model, terminal/adjudication rule |
| **VALUE** | a contribution to score, as `⟨Bound, density⟩` | **weighted monoid** (sum) over a common frame, with interval arithmetic on the sound half | material, health, king margin, reach, room, command, tier-window, sever threat, share curvature, the four potion terms |
| **REDUCTION** | how an enemy-indexed value becomes ONE comparable key | **exactly one** (choice, not composition) — composing two reductions is a category error | maximin floor (kernel today), belief `mu` rung, staging ladder, α/CVaR (absent) |
| **ACTION** | what plans exist and in what order | **additive monoid on logits** (order-not-set law) + a *lattice* on the candidate SET (only kernel may close) | gain ordering, edge-EV surrogate, potion ordering, multi-start seed, cluster factorisation, roles (absent), commitment plans (absent) |
| **ECONOMY** | what work to buy next, when to emit | **exactly one policy**, parameterised; sub-budgets compose by *partition* (they must sum to ≤ 1 of the budget) | slice loop, depth ration, VOI/cost, cluster rations, interruption/re-entry policy |

Five kinds, and the mapping to the domain's irreducible facts is one-to-one:
MODEL = the world is a shared deterministic transition system with one hidden
coordinate; REDUCTION = moves are simultaneous, so value is a *function over
enemy actions* and something must reduce it; ACTION = the team move is a product
space with contested-cell structure; ECONOMY = the decision is an anytime,
interruptible process; VALUE = the only thing that is genuinely a matter of
taste.

Two immediate consequences worth stating loudly:

- **REDUCTION is a joint and today it is smeared.** Fear/pessimism currently
  lives in the maximin bank floor, in the belief rung's position above the floor
  comparison, in the staging ladder's order, in the posture governor's defaults,
  and in each term's own conservative reading. The DoF synthesis's D3 ("fear is
  expressed exactly once") is unimplementable while the reduction is not a
  single named object. Making it one is what lets the *worst-case-only* opponent
  member the owner ruled for (ruling 13) be *the member currently seated at the
  MODEL/replies joint* rather than an assumption baked into four files — and
  makes the dodge-discount rule a second member of that same collection instead
  of a term bolted onto an evaluator.
- **`evaluator-selector` is not a joint.** It is ECONOMY (which work item to
  buy) and the redesign itself derives the correct rule (VOI/cost). Keep
  `always-all` and `material-only` as *instruments*, not candidates.

---

## 4. A bot is an expression that normalises to an addressed point

### 4.1 One selection type covers config-time AND within-bot dynamics

The owner asked for exactly two things in one sentence: collections "that can be
chosen from when configuring a bot **and which are also available for dynamic
decisions among within one bot**". These are the same operation at two binding
times, so they get one type:

```ts
type Choice<M> =
  | { at: 'fixed';       member: MemberId }                       // config-time constant
  | { at: 'conditional'; on: MemberId /*predicate member*/,        // per game shape
                         then: Choice<M>, else: Choice<M> }
  | { at: 'priced';      by: MemberId /*VOI member*/, over: MemberId[] }  // per board state
  | { at: 'composed';    of: Choice<M>[] }                         // uses Joint.compose
```

`fixed` is the degenerate `priced`. The predicate and the pricer are themselves
members of collections (of predicates, of pricers), so the recursion bottoms out
in the same registry and the same identity law. **Nothing new is needed to go
from "configure a bot" to "the bot decides mid-turn"** — which is the honest gap
the branching-migration pin recorded ("dynamic WITHIN-BOT selection among
collection members is lane (a)'s next increment ... not shipped, not claimed").

### 4.2 A bot value

```ts
type Bot = { readonly [J in JointId]: Choice<MemberOf<J>> }   // TOTAL — every joint bound
```

Totality is the point. There is no `undefined` meaning "whatever the constructor
felt like", no second channel, and no `??`. A bot literal in the repo's roster
is a *diff expression* over a named base for legibility, normalised on load:

```jsonc
// bots/potion-loud.json
{ "extends": "shipped",
  "value/terms": { "at": "composed", "of": ["legacy-territory", "potion-lineup@scale4"] } }
```

`potion-aware-bold` stops being a second slate: it is `shipped ⊕ potionTerms at
a different scale`, and the *arm delta* — the thing a verdict is about — is a
machine-computable structural diff, not prose.

### 4.3 The address, and the four things it buys

`botId = structuralIdentity(normalise(bot))`, truncated to a stable short hash.
One discipline, four uses that are today four mechanisms:

1. **Experiments.** An arm is `⟨codeRef, botId, seat⟩`. Two arms are an A/A pair
   iff both coordinates match — checkable, where today `verify-null` compares
   `botConfig` *and* `seatConfigs` by ad-hoc structural equality and the
   comment explains why both are needed.
2. **Caches.** Memo namespaces, worker protocol keys and the search map key on
   `⟨botId, premiseId, board⟩`. `evaluationIdentity` becomes the derived
   projection of `botId` over the VALUE joints, instead of its own hand-rolled
   string.
3. **Centaur knobs.** An operator excursion produces a *new bot value* by
   construction (a bounded reparameterisation of the seated member), so "every
   operator excursion is logged as a candidate config" is not a discipline
   anyone has to remember: the dial writes a `botId` onto the emission stamp.
   Play-strength versioning uses the same coordinates.
4. **Telemetry.** The stamp is `botId` plus the normalised bot; `BotStamp` and
   its drift-prone hand-written rows are deleted. A miner that meets an unknown
   coordinate **refuses** (the depth-idle lesson: "a zero that means 'field
   absent' is how a false crisis reads as data").

### 4.4 What a lane-(b) branch then is

An architecture branch changes `JOINTS` (which joints exist, what their laws
are). Its comparability to primary is exactly: *does the joint manifest diff
cleanly, and can each side's roster bots be addressed?* An arm today is a point
in `(code × config)` space where the code half is an opaque bundle path. Under
this factorization the *joint manifest* is a versioned data value on the branch,
so a cross-branch arm reports **which joints differ**, not merely which git ref
was built. That is the smallest change that makes the merge decision legible
without weakening the branch rule.

---

## 5. The no-shadow law (this is the anti-Frankenstein clause)

> **Law R (reachability).** Every member in the tree must be reachable from at
> least one bot in the checked-in roster. CI computes the reachability closure
> over `bots/` and asserts it equals the exported member set. A member nothing
> plays fails the build.

The failure is *actionable in exactly two ways*, which is the design: add a
roster bot that plays it (and now it can be raced and can prove engagement), or
delete it. There is no third state, so there is nowhere for a "merged but
unselected" heuristic, an off-by-default field, or a rotting arm to live. Three
corollaries:

- **No `??` between config channels.** One binding site per joint, enforced by
  the config being total (§4.2) and by a lint on the two-channel shape. The
  `evaluate ?? slate` class of defect becomes unrepresentable rather than
  remembered.
- **Engagement is derived, not hand-written.** `Joint.engagement` gives every
  member one uniform counter. A named member with zero invocations in a game is
  a **refusal**, raised at the end of the decision, not a quiet null in a
  results table.
- **Retirement takes code with it.** Already the registry's stated rule ("a
  losing entry is a deleted row"); Law R is what makes it mechanical instead of
  aspirational, and `docs/REFACTORING.md`'s deletion licence is what makes it
  cheap.

Law R also disciplines *this* proposal: the joint manifest must not grow a joint
with one member and no rival, because a joint with one member is a constant
wearing a socket's clothes. **A joint earns its row when two members exist that
a real bot in the roster seats differently.**

---

## 6. The engine API, re-cut

The vendored engine (`engine/resolveTurn.ts`, `turnEngine.ts`, `moveGrammar.ts`)
is genuinely good: pure, self-contained, one encoding of the rules, and it already
returns a rich resolution record (deaths, clashes, severedCells, traversed,
finalCell, vulnerableCollided, eliminatedTeamIDs, rotations, subStepCount). The
problem is **where the cut is drawn**, and it is drawn at *purity* rather than at
*determinism*:

```
vendored (pure):        grammar → collision phase → collision deaths → food/growth
                        → exhaustion → sever → regicide
NOT vendored (server):  ally-buff expiry · orientation rewrite · POTION COLLECTION
                        · food/potion SPAWN · effect expiry · PAWN PROMOTION
                        · winners/adjudication            (TeamSnekProcessor.applyMoves 3–6)
```

Of those seven, exactly **two are stochastic** (food spawn, potion spawn). The
other five are deterministic functions of the settled board and the turn number
— and they are precisely the transitions the owner's highest-priority capability
needs to look through: the tier window (potion collection + effect expiry), the
promotion horizon, and the terminal rule. The consequences are on the record:
"partial engine never writes tier on resolve … missing = COLLECTION in the
substrate layer above the vendored resolver"; the potion branch's design wall;
and the scoring rule implemented **three times** (server `calculateWinners`, bot
`mutual-wipe.ts`, harness `match.ts`) with a documented three-way disagreement.

### Four asks, in priority order

1. **Move the deterministic settlement inside the vendored module**, with spawn
   as an injected port:
   ```ts
   settleTurn(input, { spawn: Spawner }): Settlement   // Spawner: (state) => {food, potions}
   ```
   The server injects its RNG spawner. The bot injects `noSpawn` (or a
   distributional one). One encoding of tier windows, promotion and expiry for
   both. This is the single change that most enlarges what the bot can *search
   through* rather than *approximate around*.
2. **One adjudicator, exported.** `adjudicate(state, turn, limits) -> Outcome`
   and `sharePar(outcome) -> per-team number`. The bot's terminal pricing, the
   harness's scorer and the server all call it. A rule implemented three times
   was wrong three ways once already; the turn-limit default (100, `416d9c8`)
   makes it load-bearing on every game.
3. **Grammar queries as first-class exports.** `legalTargets(unit, state)`,
   `pathOf(unit, target, state)`, `coverOf(unit, state)` — built from the same
   `planUnitAction`/`defaultAction` the resolver uses. The bot currently
   re-derives legality and cover, and *did* get it wrong in ways the dodge-discount
   build notes record (hazard terrain unread, trail-unit walls under-filtered,
   a pawn attacker covering nothing). The human UI derives *none* of it — a
   player clicks a cell and the server silently substitutes the default action —
   so the same export is the Centaur surface's missing primitive: legal targets,
   the path a slider would actually take, and what a piece covers, identical for
   bot and human by construction, not by parallel implementation.
4. **A resolution record on the wire, and commit-arrival times.** The
   interruption design already names it (`TacticToes emits resolution record`).
   Under Law P it is the *observation with its premise attached*: the bot's
   model of the last turn stops being a re-derivation it must reconcile, and
   becomes a value it was handed. Cheap addition, and it is the only way a
   ponder/re-entry loop can be measured honestly.

Constraint respected throughout: the engine is shared with human play, so every
ask above is **additive** (a new export, an injected port with a default that
reproduces today's behaviour, a wire field). None changes what a human game does.

---

## 7. What this deletes

A factorization is only worth its migration if it *removes* things. It removes:

- `BotStamp` and every hand-written stamp row (derived from `JOINTS`).
- `botConfigFromJson`'s hand-maintained key sets and per-field type checks
  (derived from each joint's `Codec`).
- `SlateId`, `slateFor`'s switch, and the whole named-slate combinatorics
  (replaced by expressions over collections).
- The duplicate channels: `options.slate ?? bot.slate`, and any future `??`
  pair — structurally, by totality.
- `CriterionProfile` as a *separate* configuration concept (it is a composed
  VALUE choice; `evaluationIdentity` becomes a projection of `botId`).
- Every off-by-default `BotConfig` boolean that no roster bot sets (Law R:
  seat it or delete it).
- The bot's re-derived move legality and cover, once the grammar queries exist.
- Two of the three scoring implementations.

And it does *not* touch: the interval bank and its laws, the safety floor, the
soundness suite, seeded determinism, the differential-tested forward model, or
the paired-arms measurement discipline. Those are the kernel this plugs into,
and the seam rule ("changes a sound bound ⇒ kernel; changes only order or spend
⇒ member") survives verbatim as the rule that decides what may be a member at
all.

---

## 8. Falsifiers and costs (honest)

- **Law P is expensive if premises are compared naively.** Mitigation: the
  stable half of a premise is hashed once per decision (the
  `evaluationIdentity` precedent — the lineup half is built once, the profile
  half is a getter). If the hot-path cost of carrying premise ids exceeds ~1%
  of a decision, the fibration is kept as a *type-level* discipline with
  runtime checks only at the seams (memo keys, comparisons across layers,
  telemetry) — which is where every recorded defect actually lived.
- **Law R can be gamed** by a roster bot that exists only to keep a member
  alive. Counter-measure: a roster bot must appear in at least one experiment
  spec, or be marked `instrument` (bracketing baselines like `always-all` and
  `material-only` legitimately are instruments). The mark is on the bot, not
  the member, and it is one row that a reviewer can see.
- **The five kinds may be four.** If REDUCTION never grows a second member
  (the owner has ruled: worst-case only for now), it is a constant, and by §5's
  own rule it must not be a joint. The honest position: build it as a named
  object *because the passivity finding is 4× confirmed and structural*, but
  do not call it a joint until the dodge-discount rule is seated in it as a
  second member — at which point it has two.
- **The joint manifest can rot like anything else.** The check that keeps it
  honest is that every derived artifact (config codec, stamp, manifest columns,
  docs table) is *generated*, so a joint that stops being read stops appearing
  everywhere at once.

---

## 9. Next cycles

1. Worked example: the current bot expressed as a `Bot` value over `JOINTS`,
   end to end, with the byte-identity argument spelled out.
2. The premise lattice, concretely: coordinates, join, widening records, and
   which existing refusals become instances.
3. Migration order in lane-(b) increments, each with its own falsifier.
4. Engine-API sketch as a diff against `engine/` and the settlement phases.
