# SYNTHESIS — the factorization, the build order, and what it costs

Final document of the COMPOSITION lens (joints, configuration, registries, the
engine API, how strategy collections compose). Standalone: nothing below
requires the other six documents, which hold the derivations.

---

## 1. The argument, whole

**The disease.** Every expensive failure this program has had is one shape: *a
value and the premise it was computed under travel separately, so two things
that are not comparable get compared and nobody is told.* The potion lineup
played by the shipped evaluator for its entire measured life; a switch set and
silently overridden per engine; a miner reading a field name nothing published
and reporting a working layer dead; an arm's config merged into every seat; two
staleness conventions silently doubling a head-start. The bounds layer solved
this locally — assumptions on `ScoreBounds`, cross-basis refusal, an evaluation
identity as a memo namespace — and **every place that discipline stops is where
weeks were lost.**

**The factorization.** Four moves, in dependency order:

1. **Values are fibered over premises.** A premise is the *index*
   `⟨support-index, observable-index, measure-index, config-index⟩`; the
   EPISTEMICS lens's `(S, w)` is the fiber's *content*. Comparison is legal
   inside a fiber only. Three operations move between them: **join** (widen —
   total, sound, free, lossy), **meet** (narrow — partial, priced, with two
   purchase columns: buying the narrowing, or the anticipatory meet held
   conditional), and **advance** (transport at turn resolution — identity,
   incumbency and attention cross; values never do).

2. **Joints are a data manifest; members are entries; composition is a law per
   joint kind.** Five kinds, each with a typed law: **MODEL** (lattice join),
   **VALUE** (weighted monoid over a common currency), **REDUCTION** (exactly
   one — composing two is a category error), **ACTION** (additive over the
   currency for order; lattice for the closure, which is kernel), **ECONOMY**
   (one policy; sub-budgets partition purchasable meets). The config codec, the
   stamp, the manifest columns, the diff and the docs table are *generated from
   the manifest*, not written five times.

3. **A bot is a total map from joints to choices, normalising to an addressed
   point.** `Choice = fixed | composed | conditional | priced` — one type for
   config-time and within-decision selection, recursing through the same
   registry. `botId = structuralIdentity(normalise(bot))`. Totality makes the
   two-channel `??` defect unrepresentable; the address makes experiments,
   caches, operator excursions and telemetry share one coordinate system.

4. **Nothing unreachable may exist.** Every member must be reachable from a bot
   in the checked-in roster; CI asserts closure equals exports. Two remedies:
   seat it, or delete it. There is no third state, so there is nowhere for an
   unplayed heuristic, an off-by-default field, or a rotting arm to live.

**Why this is a carving of the domain and not a taxonomy.** The five kinds are
one-to-one with the game's irreducible facts: the world is a shared
deterministic transition system with one hidden coordinate (MODEL); moves are
simultaneous, so a plan's value is a *function over enemy actions* that
something must reduce to a comparable key (REDUCTION); the team's move is a
product space with contested-cell structure (ACTION); the decision is an
anytime, interruptible process (ECONOMY); and only the valuation is genuinely a
matter of taste (VALUE). The owner's five example sockets land inside this —
four of them in ACTION/ECONOMY, one in VALUE — and the two joints his list did
not name (MODEL's enemy-action socket, REDUCTION's fear surface) are precisely
the two the DoF synthesis independently identified as the biggest re-carves.

---

## 2. The findings that make it concrete

Each was read off the shipping code, and each is a place the current
factorization costs something measurable.

1. **The joint list is enumerated five times** — `SlotId`, `BotConfig`'s
   fields, `botConfigFromJson`'s key set, `BotStamp`, the kit's manifest
   columns. `MechanismReport.loop` had to be retrofitted because a missing
   upstream counter made "the layer refused" indistinguishable from "the layer
   was never asked".
2. **Two channels for one joint, joined by `??`.** `options.slate ?? bot.slate`
   still stands; `evaluate ?? evaluatorForSlate` cost every potion measurement
   the program had taken.
3. **Slates are hand-written records, so variation is copy.** Four numbers'
   difference costs a whole second slate, four new ids, a second weights table
   and a fourth branch in a switch — and the *difference between two arms*, the
   thing a verdict is about, exists only in prose.
4. **`BotConfig` is where the flags went.** `territoryRefine: false`,
   `multistartSeed: false`, `sampledCap: false`, `search.clusterEnum` are
   unversioned, unrecorded members with no priors, no cost model, no record and
   no player.
5. **The move-selector socket's declared law is not its real law.** The registry
   declares additive logits that sum; what ships is a twelve-slot hand-written
   lexicographic comparator whose precedence vector — where the potion ordering
   win literally lives — no config can vary and no measurement attaches to. And
   (VALUE lens) it is **weight-blind**: `captureRank` ranks a weight-31 queen
   capture identically to a weight-2 snake.
6. **Admission dominates valuation, structurally.** `candidateCap: 8` closes the
   set after the comparator sorts and before anything is priced. With the VALUE
   lens's homogeneity diagnostic this becomes measurable, and it predicts that
   **the potion 4×-weights null and the potion ordering win are one fact
   measured twice** — the weights were inert because the admitted set was
   homogeneous in potion-gain until the ordering put the pickup in it.
7. **`CandidateKnobs` is three kinds in one bag** — four orderings that compose,
   five set-closures that must not, one safety policy, one model claim; and
   `keepQuiet: 2` is a number in a knob bag that closes a set.
8. **REDUCTION is five places at once** (the ladder's order, the depth rung's
   position, the bank's quantifier, the posture defaults, each term's own
   endpoint), and the bot's risk posture is therefore `ε = 1.0` chosen by
   nobody.
9. **The engine's cut is at purity where its own guard enforces determinism.**
   Six of the seven excluded phases are deterministic; only spawn is random.
10. **The adjudication rule exists three times and has disagreed three ways**,
    and the turn-limit default now runs that branch at the end of every game.
11. **The human UI derives no legality at all**; the bot re-derives it and got
    it wrong three ways.
12. **The bot is memoryless across turns** — five scalars and a turn-scoped pin
    ledger — and five separate capability asks need exactly that one missing
    object.
13. **The experiment coordinate system is half-built**: the board side is
    content-addressed, the bot side is labelled.

---

## 3. Build order

Increments 1–3 are shared with the other lenses and should be built once. Each
is independently valuable, each has a falsifier, and only the last two change
behaviour.

| # | increment | shared with | falsifier |
|---|---|---|---|
| **B0** | `botId` stamped on the mechanism report; the kit records it per seat; `verify-null` compares addresses | — | none needed: one field, no behaviour change. It makes "did both arms play the bots the manifest says?" a one-line check |
| **B1** | the value table on `BankResult` — `{envelope[(h, frame)], estSound, estAdvised, advisoryPrecision}`; belief reads `estSound`; comparator rungs declare read-sets | EPISTEMICS §7.1–2 | the dose-response curve (floor-decided fraction falling as advisory weight rises) must flatten. **Add `frame` to the key or shadow-driven invocation cannot be built on top** |
| **B2** | the joint manifest; config codec, stamp, manifest columns and diff generated from it; `BotStamp` and the hand-written key sets deleted | TIME (declaration record) | the generated stamp must reproduce `BotStamp` field-for-field on a replay corpus |
| **B3** | bots as total addressed values; roster directory; `botDiff`; reachability + single-binding + Law-S checks in CI | — | R1 must flag `territoryRefine`, `multistartSeed`, `sampledCap`, `search.clusterEnum` on today's tree, or the closure is computed wrong |
| **B4** | `settleTurn` with the spawner injected — effects, then potion collection, then orientation, then the pawn-to-queen rule, then adjudication; `adjudicate`/`sharePar` exported and called by all three consumers; grammar queries exported | VALUE (engine asks) | the potion-window acceptance game: the bot walks to a potion three turns early, the window opens **in the model**, the cut lands. Cannot pass today at any budget |
| **B5** | the carried premise: pins, reference actions, commitments, roles and stances as one object with lifetimes; the `⟨board, premise⟩` attention map | TIME (advance) | instrument address recurrence under live operator play; near-zero recurrence kills the map half, and the commitment half must then stand alone |
| **B6** | the ordering joint: additive over the weight-flow currency, one risk-concentration parameter, one derived band at the account-wipe cliff (precedence-as-data only as fallback) | VALUE | the shipped order must be reproduced exactly on generated candidate sets before any bot names a different one |
| **B7** | the reduction joint: one `(weight-supplier, ε)` binding read by every reduction site; `ε = 1` default | EPISTEMICS §5, §7.4 | check for double-charged pessimism first: hold ε fixed, vary `plyCap`; if the depth-effect rate falls as plies rise, the blended value and `sigmaOfPly`'s width terms are discounting the same uncertainty twice |

Two rules govern the whole order. **Byte-identity at every step**, proved
against the existing cross-build gate, with `bots/shipped.json` *generated* from
today's defaults rather than written by hand. And **nothing lands without a
roster bot that plays it** — which is the reachability law applied to the
migration itself.

---

## 4. What I refuse to build

- **No joint with one member.** A collection of one is a constant wearing a
  socket's clothes. Build the enemy-weight *supplier interface* because four
  consumers already improvise one; it becomes a joint when a second member
  exists that a roster bot seats.
- **No generic plugin surface.** `Choice` and `compose` are closed forms over a
  fixed manifest. New behaviour needs a branch, which is the two-lane rule.
- **No config-driven kernel.** The seam rule stands: if it can move a sound
  bound it is kernel behind the law harness. Set-closures stay kernel even
  though they are numbers.
- **No second epistemic vocabulary**, and no compatibility layer for the shapes
  being replaced — a bridge that keeps `BotStamp`, `SlateId` and the
  hand-written codecs alive beside their generated replacements recreates the
  drift this exists to remove.

---

## 5. Risks, stated plainly

1. **Premise ids could churn.** Split them: a stable half (config, frame,
   horizon) hashed once per decision, a volatile half (model, pins) per branch.
   If the volatile half cannot be made cheap, the fibration stays a type-level
   discipline with runtime checks at five seams — which is where every recorded
   defect lived anyway.
2. **Law R can be gamed** by a roster bot that exists only to keep a member
   alive. Counter: a roster bot must appear in an experiment spec or be marked
   an instrument, and the mark is one visible row.
3. **The manifest can rot** like anything else. What keeps it honest is that
   every derived artifact is generated, so a joint that stops being read stops
   appearing everywhere at once.
4. **The engine re-cut could hit a phase that needs state the wire does not
   carry.** Read against the source it does not, but the falsifier is per phase
   and the increments are ordered so the cheapest phases prove the pattern
   first.
5. **This is a large change to a working bot.** Mitigation is the order above:
   B0 is one field, B1–B3 are byte-identical by construction, and the two
   behaviour-changing increments come last and are each gated on reproducing
   today's behaviour exactly before anything new is selectable.

---

## 6. Owner-facing summary

*(Piped through `tools/principal-glossary/check-briefing.js` on
`claude/cluster-lookahead` — 0 blocking, 0 owed, exit 0.)*

- Every configuration choice the bot makes lives in one table of decision
  points, and everything else — what a bot file may say, what a game record
  stamps, what a results column is named, what two experiment arms differ in —
  is generated from that one table instead of being written out by hand in five
  places, which is where the drift that has cost us whole measurement rounds
  comes from.
- A bot becomes a single value with an address: two bots differ by a printable
  difference, an experiment arm is that address, a human operator turning a dial
  in a live game produces a new address automatically, and asking "did both
  sides play the bots the record says they played" becomes a one-line check
  rather than the unanswered question that invalidated every potion measurement
  we had taken.
- Every number the bot computes carries the assumptions it was computed under,
  so two numbers that were never comparable can no longer be compared silently —
  the same rule that keeps our proved floors honest also keeps our measurements
  honest, and the four most expensive failures on record were all this one rule
  going unenforced outside the proofs.
- A heuristic that no configured bot can play fails the build. There are exactly
  two remedies: give it a bot that plays it, or delete it. That is the
  structural version of your objection to accumulating code nobody runs.
- The game engine's own rule for what may be shared with the bot is "nothing
  random, nothing that reads the outside world", but the split was actually
  drawn at "nothing that needs game state" — and six of the seven phases on the
  wrong side of that line are perfectly predictable: potion pickup, effect
  expiry, a pawn turning into a queen, and who wins. Only the spawning of new
  food and potions is random. Moving the predictable six across, with spawning
  passed in, is what lets the bot search through a potion window instead of
  guessing around it.
- The rule for who wins is written three separate times — in the game, in the
  test harness, and in the bot — and all three have disagreed with each other.
  One shared version, called by all three.
- The human interface derives nothing about the rules: a player clicks a square
  and, if that move is not legal for that piece, the server quietly substitutes
  a default move. The same three small functions that would fix the bot's
  home-made copies of the movement rules would let the interface show a player
  what a piece can actually do.
- The bot forgets everything between turns. Five of the capabilities asked for —
  potion plans, unit roles, per-opponent stances, learning within a game, and
  resuming the thinking we already did when a human changes their mind and
  changes it back — all need the same one missing thing, which is a way to carry
  a commitment across turns that can never override a safety refusal.
