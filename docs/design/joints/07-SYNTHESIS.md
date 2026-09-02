# SYNTHESIS — the factorization, the laws, the build order, and what it costs

Standalone summary of the COMPOSITION lens (joints, configuration, registries,
the engine API, how strategy collections compose). Current as of cycle 10. Nothing below requires the other documents,
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

*A joint declares two things, and they are not the same decision: its **kind**
(the composition law — the domain's joint, stable because it follows the game)
and its **module** (the hiding unit — the design's joint, chosen to absorb
churn). Co-change mining (weighted by commit size, mechanical sweeps excluded) says they
coincide at **3.10×** and diverge sharply for ACTION — one law over four things
whose changes are unrelated, so ACTION is **a kind with no module of its own**,
hosted in its consumers' modules. This is Parnas's standing position (1979;
Parnas/Clements/Weiss 1985: a system needs several distinct structures, and
conflating module with uses is a standard error), reached here from measurement.
See `27-DSM-AND-BUDGET.md` and `29-DSM-WEIGHTED.md`.*

| kind | member is | composition law | notes |
|---|---|---|---|
| **MODEL** | a premise-producing claim about the world | **lattice join** (weakening only) | credal sets join; `'adversarial'` is the zero point, not a weight. Non-linear in the measure |
| **VALUE** | a contribution in the weight-flow currency, at a declared **participant scope** | **Möbius decomposition** under a **declared scalarization** (weighted-sum default; Chebyshev / ε-constraint / lexicographic are peer members, because a weighted sum provably cannot reach Pareto points off the convex hull at any weight) | the additive law is the `k = 1` truncation; the shipped edge-EV surrogate is already `k = 2` |
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
| **H** (cross-horizon) | horizons never compare as projections; they meet only inside a fold that declares its discount. **H′, the index-side twin:** across horizons the sound channel yields the **hull**, never an intersection — equality of horizon is a precondition of tightening | the depth rung's licence, and the reason the sound channel has almost nothing to say across horizons |
| **M** (sub-provenance) | a member with internal structure declares its parts; engagement counts per part | where Frankenstein relocates |
| **N** (no config language) | the bot value is data — literals, member ids, four `Choice` forms; no interpolation, expressions or cross-references | every Hydra/gin failure mode |
| **T** (tightening) | index equality does not merely license comparison — values at an equal index **compose to a tighter bound**. Refusal is what the index costs; tightening is what it pays | the bank already does this, and it is why its basis discipline survived four months of churn |
| **I** (identity separation) | content hashes and stable names are never interchanged — **names find, hashes validate**; a cache keyed by name is a bug, a carry keyed by hash is a bug | the search map, attention carry, warm promotion |
| **A** (argument premises) | a soundness argument carries its hypotheses, checkable at the site that consumes the guarantee; dissolve → derive → assert → drop-and-record, and every hypothesis owes a falsification test | five of six recorded defects of this class are already dissolved structurally |
| **V** (vocabulary walls) | a claim of the form "X may only speak through channel Y" is enforced by a closed import vocabulary **plus** a lint ban **plus** a falsification test, and is not made without all three | the advisory channel, ADVICE's one-way flow, the rules artifact |
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
6. **Admission dominates valuation where the cap binds — now measured**: the
   per-unit cap binds on **100% of slider decisions and 0% of snake/leaper**, a
   queen's mean **64.4** options against a cap of **4**, and the discarded set is
   the **most differentiated** one. Admission operates at three granularities
   (per unit, per cluster joint under the 512 product cap, per emission), and a
   weight can be inert for five reasons — not admitted, no gradient, sparse
   support (a potion sits at a legal destination on 8.17% of unit-decisions),
   lost at joint level, or **priced and then refused by the emission rate
   limiter, which is 15–43% of every plan priced** and which no evaluator weight
   at any setting can rescue — and which is **published and priced** through an
   emission window the economy reads, never a gate on admission (`31`). A sixth cause is **non-convexity** — the argmax
   jumps between two plans as a weight crosses a threshold and never rests on
   intermediates — and it is the only one whose remedy is a different
   scalarization rather than a different number.
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

**The plan lives in `34-BUILD-ORDER.md`** — one ordered table across all five
increment lists, with dependencies, what is shared with which lens, and the
smallest useful subset. It is not repeated here: a build order in two places is
a second truth, which is the disease this design is about.

Its three headline facts, for a reader who stops at this document:

- **Only six increments change behaviour**, and four of those are gated on an
  owner decision, an engine step, or a measurement.
- **The critical path to the owner's stated priority** (potion intelligence in
  play) is `E1 → E2 → B6 → L3 → B5`, and **E2 is the keystone**: `tier` is an
  input-only field today, so a simulated turn cannot advance a window and a
  three-turn plan is unmodellable at any budget.
- **If only three things are built: `A1`, `X1–X3`, `E1–E2`** — the address that
  answers "which bot produced this number", the byte-identical half of the index
  inversion (recognition, not invention — the bank already implements it), and
  the capability unlock. Everything else improves how we build and measure;
  those three change what is possible.

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
3. **The visible layer is a cost paid by every hidden module**, and the
   co-change matrix shows the spine changing with every kind. So it carries a
   **budget** (`27 §5`): coordinates ≤ 12 components, named laws ≤ 15, kinds
   ≤ 6, `Choice` forms ≤ 4, member fields ≤ 12 — and an addition must fit or
   **name what it replaces**. Its counterweight is **INVERSION** (Baldwin–Clark):
   every "written N times" defect on the record is a missing inversion, and the
   ambiguity detector doubles as the candidate scanner — so the budget is what
   stops "invert everything" being as damaging as "invert nothing".
4. **The entry floor rises for every reader, forever.** Today a maintainer reads
   `accept()` top to bottom; afterwards the same question routes through
   manifest → choice → member → law → premise → projection. That is the real
   price, and §3's law table exists because of it.
5. **Fat members keep the non-linear content** — Law M and scoped contributions
   bound it; neither removes it.
6. **This is a large change to a working bot** — B0 is one field, B1–B3 are
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
