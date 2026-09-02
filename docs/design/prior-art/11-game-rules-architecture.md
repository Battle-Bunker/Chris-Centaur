# PRIOR ART 11 — game-rules architecture: one description, many consumers

Domain: how general-game frameworks structure the *rules* so that the AI, the
UI, the analysis tools and the tests all derive from one artifact. Aimed at three
recorded LOBSTER defects: **"the adjudication rule exists three times and has
disagreed three ways"**, **"the human UI derives no legality at all"**, and the
composition lens's **B4** (`settleTurn` with the spawner injected).

Read against `07-SYNTHESIS.md` §2.9–2.11 and `03-ENGINE-API.md`.

---

## 11.1 Load-bearing sources

**S28. OpenSpiel's `Game`/`State` API** (`open_spiel/docs/concepts.md`,
`spiel.h`). The minimal interface every algorithm in the library programs
against.

**S29. Browne, Soemers, Piette et al., *Ludii — the ludemic general game system*
(arXiv:1905.05013) and *An overview of the Ludii general game system*
(arXiv:1907.00240).** Games as structures of **ludemes**; a **class grammar**
that derives the game description language from the source code's class
hierarchy; separation of *form* (equipment + rules) from *function* (emergent
behaviour).

---

## 11.2 What the experts decided, and their stated rationale

### (a) OpenSpiel: chance is an explicit player, not hidden randomness

The `State` interface is deliberately small: `legal_actions()`,
`apply_action(a)`, `is_terminal()`, `returns()`, `clone()` / `child(a)`, plus
`is_chance_node()` and `chance_outcomes()`. Stochasticity is **not** hidden
inside a transition function — there is a distinguished **chance player** with an
id, and at a chance node the state *exposes the outcome distribution*. Their own
illustration: in poker "the root state would just be the players without any
cards, and the first transitions will be chance nodes to deal the cards."

The consequence, and the reason this is a design decision rather than a
convention: a search algorithm can **enumerate or sample chance explicitly**,
weight by the exposed probabilities, and reason *through* a stochastic event
instead of around it. Every algorithm in the library gets that for free because
it is in the interface, not in each game.

Second interface decision: `information_state` vs `observation` are **separate
methods**, so the same API expresses perfect-information and hidden-information
games, and an algorithm declares which it needs.

### (b) Ludii: the grammar is generated from the code, so drift is impossible

Ludii describes games as **ludemes** — named, composable rule concepts — split
into *equipment* (pieces, board), and rules into *start*, *play* and *end*. Two
architectural claims:

1. **The class-grammar approach.** "The game description language used by Ludii
   is automatically generated from the constructors in the class hierarchy of the
   Ludii source code", and "game descriptions expressed in the grammar are
   automatically instantiated back into the corresponding library code for
   compilation, **giving a guaranteed 1:1 mapping between the source code and the
   grammar**."
2. **Form vs function.** The description carries the rules; behaviour is
   *emergent* and is measured, not declared. Everything downstream — playing, the
   UI, AI, historical analysis in the Digital Ludeme Project — consumes the one
   description.

Their reported efficiency result matters too: Ludii outperforms a
propositional-network GDL reasoner on all games in the Tiltyard repository —
i.e. a declarative one-description design is not automatically slow.

---

## 11.3 Mapping onto our joint

### AGREES — strongly, and it sharpens the manifest move

- **"Generated from the manifest, not written five times" is Ludii's central
  claim**, and Ludii proves the stronger version: derive the *description
  language itself* from the class hierarchy so the mapping is **1:1 by
  construction**. Our composition lens proposes a manifest that generates the
  codec, stamp, columns, diff and docs. Ludii's refinement is that the manifest
  should not be a *separate artifact maintained beside the types* — it should be
  derived from them (or they from it) with a checked bijection, because a
  hand-maintained manifest is a sixth place for the joint list to live and will
  drift exactly like the other five. This is the difference between "one more
  file" and "structurally impossible to disagree", and it is worth the extra
  build cost.
- **The `Choice` type's closed form matches the ludeme discipline**: a fixed,
  named vocabulary of composable concepts, not a generic plugin surface. Ludii is
  the existence proof that a closed grammar can cover an enormous space (1,000+
  traditional games) while staying fast.

### CONTRADICTS — flag loudest

**C34. B4's "inject the spawner" is a weaker version of the right move, which is
to make chance an explicit player with an exposed distribution.** The composition
lens's B4 proposes `settleTurn` with the spawner injected — effects, potion
collection, orientation, promotion, adjudication — so the six deterministic
phases move to the bot's side and only randomness is passed in. That is correct
and it is the right ordering. But *injecting* a spawner gives the search a
**sample**; OpenSpiel's chance node gives it a **distribution**.

  The difference decides B4's own falsifier. The acceptance game is "the bot
  walks to a potion three turns early, the window opens **in the model**, the cut
  lands." With an injected spawner the bot searches one sampled future and the
  window either happens to open or does not; with an exposed `chanceOutcomes()`
  it can weight the branch by its actual probability (potions 0.15/turn, per the
  belief lens's finding) and price the walk correctly *without* the window
  actually opening in the sample. Since our spawn distribution is simple and
  known, exposing it is nearly free, and it is the difference between a search
  that can plan around a stochastic window and one that gambles on a draw.

  Corollary for the belief lens: an exposed chance distribution is also the
  cleanest way to state the **time-indexed CloudPremise** (their finding 3 — the
  static premise is unsound because production spawns potions every turn). If
  spawning is a chance node with a declared distribution, the cloud's dilation
  under spawning is *derived from the interface* rather than being a hand-written
  premise that can go stale.

**C35. "The adjudication rule exists three times" is a symptom of having no
single rules artifact, and exporting one function does not fix the class.** B4
proposes exporting `adjudicate`/`sharePar` and having all three consumers call
it. That fixes *this* rule. Ludii's and OpenSpiel's answer is structural: there
is exactly one place a rule can be written, and every consumer is a *derived*
reader of it — legality, terminality, returns, and the UI's affordances all come
out of the same object.

  Our recorded defects are three instances of one class: adjudication written
  three times; the human UI deriving no legality and the server silently
  substituting a default move when a click is illegal; and the bot re-deriving
  movement rules and getting them wrong three ways. The remedy that generalises
  is **a rules module whose exported surface is the full consumer interface** —
  `legalMoves(state, unit)`, `resolve(state, orders)`, `settle(state, chance)`,
  `adjudicate(state)`, `outcomeDistribution(state)` — with a CI check that no
  consumer re-implements any of them. Exporting one function per discovered
  defect will keep finding defects one at a time.

  And the payoff is already identified in our own docs: "the same three small
  functions that would fix the bot's home-made copies of the movement rules would
  let the interface show a player what a piece can actually do." That is the
  Ludii thesis stated in our own words; it deserves to be a design law rather
  than an observation.

### COVERS A CASE WE MISSED

**M30. `information_state` vs `observation` as *separate interface methods* is
the fog programme's wire, already designed.** OpenSpiel keeps them distinct
precisely so one API covers both regimes and each algorithm declares which it
consumes. The belief lens's ObservationRecord (facts, mask, events) is the same
split. The transferable detail is that it belongs in the **engine interface**,
not only in the wire document: a consumer that asks for the information state
when it should ask for the observation is a *type* error in OpenSpiel and would
be a silent cheat in ours. That is the mechanism that makes "full-info games
byte-identical" (fog step 5's acceptance) checkable rather than hoped for.

**M31. Form vs function: rules are declared, behaviour is measured.** Ludii's
split is a discipline we half-have. Our `laws.ts`, the bounds' assumption tags
and the refusal law are all *declared form*; the mechanism report is *measured
function*. What is missing is the rule that nothing may be declared in both
places — which is precisely the failure behind "a switch set and silently
overridden per engine" and "`MechanismReport.loop` had to be retrofitted because
a missing upstream counter made 'the layer refused' indistinguishable from 'the
layer was never asked'". State it: **a fact is either derived from the rules
artifact or measured in the report; never both.**

**M32. A declarative rules layer need not be slow.** The reflexive objection to
B4 and to a single rules module is performance — our evaluator lives inside a
slab discipline with a µs budget. Ludii's benchmark answer (beating a
propositional-net GDL reasoner across the whole Tiltyard corpus) is the standing
counter-evidence, and the mechanism is the same one `cluster-enum.ts` already
uses: compile the declarative description into the fast representation once, then
run the fast representation. The rules artifact is a *build-time* object.

---

## 11.4 Verdicts the lens agents can act on

- **COMPOSITION (two upgrades to B2 and B4):**
  1. **B2 — derive the manifest from the types with a checked bijection**, rather
     than maintaining it beside them. Ludii's class grammar gives a "guaranteed
     1:1 mapping between the source code and the grammar"; a hand-maintained
     manifest is a sixth home for the joint list and will drift like the other
     five. This is the strongest external validation of the manifest move in the
     survey, and it argues for the more expensive version.
  2. **B4 — expose the spawn *distribution*, not an injected sampler.**
     OpenSpiel's chance-player design is the difference between planning through
     a stochastic potion window and gambling on a sampled draw, and B4's own
     acceptance game is the case that separates them. Our spawn law is simple and
     known, so the cost is near zero.
  3. Generalise the adjudication fix: **one rules module whose exported surface
     is the whole consumer interface**, with CI forbidding re-implementation.
     Exporting one function per discovered defect will keep discovering them.
- **BELIEF:** an exposed chance distribution derives the time-indexed
  CloudPremise from the interface instead of restating it as a premise that can
  go stale — which is the one vendored-engine amendment the fog programme
  requires, obtained as a side effect of B4 done the OpenSpiel way. And put the
  information-state / observation split in the **engine interface**, so asking
  for the wrong one is a type error rather than a silent cheat; that is what
  makes fog step 5's byte-identity acceptance checkable.
- **ALL:** adopt Ludii's form/function law — *a fact is either derived from the
  rules artifact or measured in the report, never both.* Two of our four most
  expensive recorded failures are that law being violated.
