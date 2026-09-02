# SYNTHESIS — the factorization, the laws, the build order, and what it costs

Standalone summary of the COMPOSITION lens (joints, configuration, registries,
the engine API, how strategy collections compose). Current as of cycle 8;
supersedes the cycle-5 version. Nothing below requires the other documents,
which hold the derivations, the red-team exchanges and the prior-art audit.

---

## 1. The argument, whole

**The disease.** Every expensive failure this program has had is one shape: *a
value and the premise it was computed under travel separately, so two things
that are not comparable get compared and nobody is told.* The potion lineup
played by the shipped evaluator for its entire measured life; a switch set and
silently overridden per engine; a miner reading a field name nothing published
and reporting a working layer dead; an arm's config merged into every seat; two
staleness conventions silently doubling a head start. The bounds layer solved
this locally — assumptions on `ScoreBounds`, cross-basis refusal, an evaluation
identity as a memo namespace — and **every place that discipline stops is where
weeks were lost.**

**The factorization.** Four moves, in dependency order:

1. **Values are fibered over premises.** A premise is the *index*
   `⟨support, observable, measure, config⟩`; the EPISTEMICS lens's `(S, w)` is
   the fiber's *content*. Comparison is legal inside a fiber only. Three
   operations move between fibers: **join** (widen — total, sound, free, lossy),
   **meet** (narrow — partial, priced, with two purchase columns: buying the
   narrowing, or the *anticipatory* meet held conditional), and **advance**
   (transport at turn resolution — identity, incumbency and attention cross;
   values never do).

2. **Joints are a data manifest; members are entries; composition is a law per
   kind.** Six kinds, each with a typed law (§2). The config codec, the stamp,
   the manifest columns, the diff, the operator knob schema and the docs table
   are all *generated from the manifest*, never written five times.

3. **A bot is a total map from joints to choices, normalising to an addressed
   point.** `Choice = fixed | composed | conditional | priced`, one type for
   config-time and within-decision selection, each carrying a transport
   declaration. `botId` addresses identity; `behaviourId` addresses equivalence.

4. **Nothing unreachable and nothing unplayed may exist.** Every member must be
   reachable from a roster bot *and* engaged in a validated run, with a
   self-retiring waiver for capabilities whose game mode does not exist yet.

**Why this is a carving of the domain.** Five of the six kinds are one-to-one
with the game's irreducible facts: the world is a shared deterministic
transition system with one hidden coordinate (MODEL); moves are simultaneous, so
a plan's value is a *function over enemy actions* that something must reduce to
a comparable key (REDUCTION); the team's move is a product space with
contested-cell structure (ACTION); the decision is an anytime, interruptible
process (ECONOMY); the valuation is the one thing that is genuinely a matter of
taste (VALUE). The sixth is one-to-one with *this product's* irreducible fact:
**there is a human in the loop** (ADVICE) — a fact my first five denied by
omission, and the red team was right that omitting it made the program's stated
purpose inexpressible.

---

## 2. The six kinds and their laws

| kind | member is | composition law | notes |
|---|---|---|---|
| **MODEL** | a premise-producing claim about the world | **lattice join** (weakening only) | credal sets join; `'adversarial'` is the zero point, not a weight. Non-linear in the measure |
| **VALUE** | a contribution in the weight-flow currency, at a declared **participant scope** | **Möbius decomposition** — disjoint scopes add; overlapping scopes emit residuals; arity capped by identifiability | the additive law is the `k = 1` truncation; the shipped edge-EV surrogate is already `k = 2` |
| **REDUCTION** | a rule over gambles returning a **SET** of (option, dominance condition) | **exactly one member per site class**, from a manifest table with a constraint column | maximality and E-admissibility return sets natively; Γ-maximin is the member that collapses, and the collapse belongs at the **emission barrier**. Averaging two reductions is the lower prevision of no credal set |
| **ACTION** | order over candidates (and, kernel-side, closure of the set) | additive over the currency with a derived cliff band; closure is intersection | admission dominates valuation *where the cap binds* — slider-specific |
| **ECONOMY** | what work to buy, when it must reach the wire, and when to ask the human | **two laws**: allocation = partition of **edge credits** over purchasable and anticipatory meets; obligation = **meet on deadlines** (the tightest binds; the kernel pin is the bottom element) | **two currencies — compute quanta and operator attention — with no exchange rate**, because a rate would let the scheduler spend the human. Sharing makes node-partitioning false, so credits attach to edges and Zilberstein's tree-shaped optimality is deliberately dropped |
| **ADVICE** | a value over *sets* of plans for the operator | **monotone submodular under a cardinality (attention) budget**, greedy | sink is the operator surface; one-way constraint — no staged-plan joint may read it |

---

## 3. The laws, consolidated

The red team's fair complaint is that a reader now needs a vocabulary before
reading any file. So: every law this lens asserts, one line each.

| law | statement | where it bites |
|---|---|---|
| **P** (fibration) | every value carries its premise; comparison inside a fiber only; crossing is a join or a refusal | bounds, memos, worker keys, telemetry, harness rows |
| **S** (dynamic selection) | a dynamic choice may range over VALUE, ACTION-order and ECONOMY joints, never MODEL or REDUCTION | expressed as an `excludes` constraint row |
| **R** (reachability) | reachable from a roster bot **and** engaged in a validated run, or seated, or deleted; waivers name a blocking condition and expire | CI; the anti-Frankenstein clause |
| **K** (calibration) | a measured value may affect behaviour only if replayable from declared coordinates plus the ledger, or spend-only; replayable suppliers read ledger observables, never timing | `stepCostMs`, EWMAs, in-game adaptation |
| **B** (blend-at-read) | no stored value is ε-blended; comparators blend at the read | stops `(1−ε)^d` compounding returning through the cache |
| **C2 / C4** (commitments) | a commitment may change order and spend, never a bound or a refusal; it records the reduction binding it was formed under and re-justifies when that changes | the interruption theorem makes this dominance, not caution |
| **D** (delivered reads) | a comparator receives the projection for its declared coordinates and nothing else | answering "the metadata said X, the code did Y" with more metadata repeats it |
| **H** (cross-horizon) | horizons never compare as projections; they meet only inside a fold that declares its discount | the depth rung's licence, previously unwritten |
| **M** (sub-provenance) | a member with internal structure declares its parts; engagement counts per part | where Frankenstein relocates |
| **N** (no config language) | the bot value is data — literals, member ids, four `Choice` forms; no interpolation, expressions or cross-references | every Hydra/gin failure mode |
| **I** (identity separation) | content hashes and stable names are never interchanged — **names find, hashes validate**; a cache keyed by name is a bug, a carry keyed by hash is a bug | the search map, attention carry, warm promotion |
| **bijection** | 1:1 between manifest rows and the kernel artifacts they name, checked in CI; a row naming nothing, or an implementation no row names, fails | stops the manifest becoming a sixth enumeration |
| **F1 / F2** (fit provenance) | a fitted number names its fit; re-fitting mints a new member id; the transfer penalty is **generated** from the two premise records, never member-computed | ruling 49 |

Plus **three** identities, obeying different laws: `botId` input-addressed
(identity), `behaviourId` output-addressed over a canonical probe suite
(equivalence, and the early cutoff that keeps a re-fit from invalidating every
measurement), and a **stable `Name`** that must *not* change across the
revisions we want reuse across (carry, warm promotion, transport across
`advance`).

And the premise index, final: `⟨support, observable, measure, config⟩` where
observable = `⟨horizon, provenance-of-computation⟩` (computed terms, admitted
set, conditioning depth, resolved selections) and measure = `⟨weight, range⟩` —
the range being what history implies about where we are, degenerate under full
observability and load-bearing the day masks arrive.

---

## 4. The findings that make it concrete

1. The joint list is **enumerated five times**; `MechanismReport.loop` had to be
   retrofitted because a missing upstream counter made "the layer refused"
   indistinguishable from "the layer was never asked".
2. **Two channels for one joint joined by `??`**: `options.slate ?? bot.slate`
   still stands; `evaluate ?? evaluatorForSlate` cost every potion measurement.
3. **Slates are hand-written records**, so a four-number variation costs a whole
   second slate and the arm delta exists only in prose.
4. **`BotConfig` is where the flags went**: four off-by-default alternatives with
   no id, no record, no priors and no player.
5. **The move-selector socket's declared law is not its real law** — additive
   logits declared, a twelve-slot lexicographic comparator shipped — and it is
   **weight-blind**: a weight-31 queen capture ranks identically to a weight-2
   snake.
6. **Admission dominates valuation where the cap binds**, which is
   slider-specific (`sliderCandidateCap: 4` against a queen's ~71; trail units
   never truncate). Two causes make a weight inert — not in the priced set, or
   constant across the plans compared — with opposite remedies.
7. **`CandidateKnobs` is three kinds in one bag**, and `keepQuiet: 2` is a number
   in a knob bag that closes a set.
8. **REDUCTION is five places at once**, so the bot's risk posture is `ε = 1.0`
   chosen by nobody.
9. **The engine's cut is at purity where its own guard enforces determinism**:
   six of seven excluded phases are deterministic; only spawn is random.
10. **The adjudication rule exists three times and has disagreed three ways**,
    and the turn-limit default now runs that branch at the end of every game.
11. **The human UI derives no legality at all**; the bot re-derives it and got it
    wrong three ways.
12. **The bot is memoryless across turns**, and five capability asks need that
    one missing object.
13. **The experiment coordinate system is half-built**: boards content-addressed,
    bots labelled.
14. **The bot address has no production binding site**: the live process always
    plays `DEFAULT_BOT_CONFIG`; one bot per process for every game and seat.
15. **The value model has no boundary condition.** The interior fold is complete;
    100% of the residual, and all game-length dependence, sits at terminal
    adjudication — and the bot reads no turn limit anywhere.
16. **A human-authorised sacrifice already plays today** (`matchPin` resolves
    against the pruned ledger; the bot never unpins), so the sacrifice wall is
    in admission and advice, not in emission.
17. **Commit timing is a live strategy axis nobody uses**: commit status is
    world-readable and live, a commit is irrevocable, and the turn ends when the
    last player commits — so an early commit is both a credible public
    commitment and a clock denial.

---

## 5. Build order

Shared increments are marked; each has a falsifier; behaviour-changing steps are
last.

| # | increment | shared with | falsifier |
|---|---|---|---|
| **B0** | `botId` + `behaviourId` stamped; kit records per seat; `verify-null` compares addresses | — | none needed: one field, no behaviour change |
| **B1** | value table on `BankResult` — `envelope[(horizon, frame)]`, `estSound`, `estAdvised`, `advisoryPrecision`; rungs declare read-sets | EPISTEMICS | the dose-response curve must flatten; **`frame` in the key or shadow-driven invocation cannot be built on it** |
| **B2** | the joint manifest; codec, stamp, columns, diff, knob schema generated; `BotStamp` and hand codecs deleted; ambiguity detection over declared coordinates | TIME (allowance-ledger schema — one increment) | generated stamp reproduces `BotStamp` field-for-field; every behaviour-affecting measured value is classified under Law K or the build fails |
| **B3** | bots as total addressed values; roster; `botDiff`; reachability + single-binding + Law-S checks | — | R must flag `territoryRefine`, `multistartSeed`, `sampledCap`, `search.clusterEnum` on today's tree |
| **B4** | `settleTurn` with the spawner injected; `adjudicate`/`sharePar` exported and called by all three; grammar queries exported | TIME (replay-rebase dependency), VALUE | the potion-window acceptance game: the window opens **in the model** |
| **B4t** | **the terminal-boundary row** — `model/terminal@1` sourced from the export, the fold's interior domain declared, `FitProvenance.metric` as that member id | VALUE | the +0.969 game-length dependence moves into explained variance; and three turns from the cap a terminal-seated bot declines a trade a capless bot takes |
| **B5** | the ADVICE kind with sacrifice-warrant, commit-timing and disagreement members (**owner decision required** — `13`) | — | on a seeded board the warrant appears, the staged plan is unchanged, and a pin makes it play |
| **B6** | carried premises + the `⟨board, premise⟩` attention map; mutations as deferred commands at sync points | TIME | **split**: within-turn re-entry rate for the map; cross-turn on decisions changed, never recurrence |
| **B7** | the ordering joint: additive over the currency plus the named residual precedence (death band, bound-width→ECONOMY, tie key) | VALUE | shipped order reproduced exactly on generated candidate sets |
| **B8** | the reduction site-class table; ε applied once at the read; supplier members | EPISTEMICS | Law B's check (no persisted blend) plus the double-discount test: hold ε, vary `plyCap` |

Two rules govern the order: **byte-identity at every step**, with
`bots/shipped.json` *generated* from today's defaults rather than written; and
**nothing lands without a roster bot that plays it**.

---

## 6. What I refuse to build

- **No joint with one member** — a collection of one is a constant wearing a
  socket's clothes. Build the weight-supplier *interface* because four consumers
  already improvise one; it becomes a joint when a second member exists.
- **No generic plugin surface, and no config language** (Law N). New behaviour
  needs a branch; that is the two-lane rule.
- **No config-driven kernel.** Set-closures stay kernel — **except** the one
  premise-indexed exception the sacrifice law would add, which is an owner
  decision and not an engineering one.
- **No second epistemic vocabulary, and no compatibility layer** for the shapes
  being replaced.

---

## 7. Risks, stated plainly

1. **Premise ids could churn** — split stable (config, frame, horizon) from
   volatile (model, pins); if the volatile half cannot be cheap, keep the
   fibration as a type discipline with runtime checks at five seams.
2. **The generator is a compiler**, and when the manifest is wrong five artifact
   classes are wrong *in agreement* — so one artifact class must be produced by
   an independent path and compared. Drift detection cannot come from the same
   source as the artifacts.
3. **The entry floor rises for every reader, forever.** Today a maintainer reads
   `accept()` top to bottom; afterwards the same question routes through
   manifest → choice → member → law → premise → projection. That is the real
   price, and §3's law table exists because of it.
4. **Fat members keep the non-linear content** — Law M and scoped contributions
   bound it; neither removes it.
5. **This is a large change to a working bot** — B0 is one field, B1–B3 are
   byte-identical by construction, and everything that changes behaviour is
   gated on reproducing today's behaviour first.

---

## 8. Owner-facing summary

*(Checked through `tools/principal-glossary/check-briefing.js` — 0 blocking,
exit 0.)*

- Every configuration choice the bot makes lives in one table of decision
  points, and everything else — what a bot file may say, what a game record
  stamps, what a results column is named, what two experiment arms differ in,
  and which dials a human sees — is generated from that one table instead of
  being written out by hand in five places, which is where the drift that has
  cost us whole measurement rounds comes from.
- A bot becomes a single value with an address, so two bots differ by a
  printable difference, an experiment arm is that address, and a human turning a
  dial in a live game produces a new address automatically. A second address
  records what the bot *does* rather than what it was asked to be, so a change
  that does not alter any decision keeps every measurement we have already paid
  for.
- Every number the bot computes carries the assumptions it was computed under,
  so two numbers that were never comparable can no longer be compared silently —
  the same rule that keeps our proved floors honest also keeps our measurements
  honest.
- A heuristic that no configured bot can play, or that never actually runs in a
  real game, fails the build. There are exactly two remedies: give it a bot that
  plays it, or delete it.
- The game engine's own rule for what may be shared with the bot is "nothing
  random, nothing that reads the outside world", but the split was drawn at
  "nothing that needs game state" — and six of the seven phases on the wrong
  side of that line are perfectly predictable: potion pickup, effect expiry, a
  pawn turning into a queen, and who wins. Only the spawning of new food and
  potions is random.
- The rule for who wins is written three separate times — in the game, in the
  test harness, and in the bot — and all three have disagreed. One shared
  version, called by all three. This matters more than it sounds: measurement
  now says that everything our value model cannot explain sits exactly at the
  moment the game is settled, and a bot playing toward a turn limit currently
  does not know the game ends.
- The human interface derives nothing about the rules: a player clicks a square
  and, if that move is not legal for that piece, the server quietly substitutes
  a default move. The same three small functions that would fix the bot's
  home-made copies of the movement rules would let the interface show a player
  what a piece can actually do.
- The bot forgets everything between turns, and five of the capabilities you
  have asked for need the same missing thing: a way to carry a commitment across
  turns that can never override a safety refusal.
- **Needs your decision.** Today the bot may not consider giving up one of its
  own units even when the team gains by it — the move is deleted before anything
  prices it. You can already force one by pinning it, but nothing tells you the
  option exists. Option A: the bot computes these sacrifices, prices what each
  death buys, and shows them to you to authorise, along with advice on when to
  commit the turn; the safety rules do not change and the bot never plays one on
  its own. Option B: the bot also plays them itself whenever one of its
  heuristics says the trade is good. A is recommended and it produces the
  evidence that would justify B.
- **Expect this**: the first time our bot plays alongside a human against
  humans, every fitted advisory term goes quiet, because no human game exists in
  any corpus we have. That is the rule working — the proved floors, the safety
  refusals and the move ordering are untouched, and the terms earn their voice
  back as human games enter the corpus.
