# OPERATOR-SIGNALS — synthesis snapshot (cycle 9; nothing final)

Standalone summary of the OUT half of ruling 51. Details, derivations, and
the cross-lens exchanges live in `README.md`'s reading order; this file is
current as of the branch tip it ships on and is a snapshot under rulings
49/50, not an endpoint.

## 1. The design, whole

**The inventory existed; the surface didn't.** Every lens built
instruments whose natural consumer is a human operator — the undominated
option set, per-unit flows, support widths, quality curves, commitments,
refutation records — and none named the surface (doc 00). Most of the
highest-value signals are computed today and thrown away (the foil, the
restricted matrix, the deciding rung); the marginal cost of the spine is
retention, not computation.

**The type system is small because the machine's kinds already carve it**
(doc 01): four payload shapes — **SET** (options with dominance/refutation
conditions, from REDUCTION), **FLOW** (per-unit causal attributions, from
VALUE), **WIDTH** (support + what-would-remove-it, from MODEL/belief),
**HELD** (commitments with invalidation conditions, from ECONOMY) — two
operators (**trace**, **edge** — curves and alarms are derived, not base),
and two roles (**offer**, **ask**). Foils, threat maps, digests, alarms
and asks are all compositions. One falsification attempt succeeded and was
absorbed: operator what-ifs need an initiation path (`quote`, riding the
IN lens's speculation authority), not a fifth shape.

**Aggregation is governed by three laws** (doc 02): fold-never-replace
(aggregates are entry points with drill-down); anchors-are-the-causal-
grain (folding across units/channels makes statistics — legal for
ordering, banned as explanation and as the cached record); premise
discipline survives aggregation (digests segment at evaluator changes).
Selection is facility-location coverage of a generated question space —
monotone submodular, greedy, incremental in the budget — with the
operator's pins/shelves as the untouchable bottom element. The
process-industry alarm canon (ISA-18.2/EEMUA-191) supplied the temporal
hygiene the design lacked: rationalization (no alarm class without a
named operator action), shelving with expiry, hysteresis, first-out
bundles, the furniture rule, flood mode, sticky-until-acked soundness
alarms (docs 06, 10).

**The API is two surfaces** (doc 03): a selected, snapshot-replaced
**frame** per (game, team[, operator]) view doc — attention budget in
weighted units as a first-class parameter, obligation-class priority with
operator-initiated items at the bottom, freshness in ledger quanta with
explicit void conditions — and a complete, team-private **store** with
read-time folds (get/query/trace/contrast/digest/quote). Statistics never
headline at this scale; headlines are bound projections that refuse when
they cannot cite their payload.

**The IN/OUT seam is a theorem, not a treaty** (doc 05): the echo of a
guidance utterance is determined by its PORT — one echo generator per
port covers every affordance the guidance lens mints, including the
belief-weight port's calibration trace (the empathy channel ships with an
empathy scoreboard). The frustration composite ("why isn't the bot doing
what I asked" — never-priced / outvoted / beaten-at-reduction / lost the
tie) is the single best exhibit of intelligent aggregation and is built
with the ports per MAPGEN's doctrine.

**Refutations and rung grades are the Centaur core** (doc 09): on
contacting boards the proved floor refutes nearly everything (search
doc-09 v2), and a refutation — (plan, refuting reply) — is the most
causal object the machine produces; one dominant refuter is one attention
item and a threat anchor. When the decision falls through to the tie
key, the machine's knowledge has run out — the **authority-collapse ask**
(unanchored by default) invites the human exactly where their judgment
has maximum leverage. This is ruling 13's division of labour as a signal.

**The same vocabulary runs the program's second scale** (doc 08): cell
verdicts, member validation states and coverage holes are HELDs and
WIDTHs at the per-experiment scale of the one index; the removal
taxonomy gains `measure(batch-cost)` — a third currency; the owner's
pending-decision queue is the ask surface with the same mooting and
flood discipline. One vocabulary, two scales, three currencies, zero
exchange rates.

## 2. What this lens asks of siblings (all recorded in docs 04/05/09)

- **time**: a surface-tithe allocation row in the phase-split — frame
  assembly must never bid at the market, or a starving search silences
  its own supervision exactly when supervision matters most.
- **search**: retention (O0) of the foil column, refutation attributions
  and matrix rows; the deciding-rung grade gains a consumer (the
  authority-collapse ask) — and the surface quotes live-plan counts only
  with the gate config in the premise.
- **value**: pre-fold flow records retained per decision; the memo
  boundary keeps flows unsummed or is disqualified as a surface source.
- **belief**: build Belief(observer) observer-generic; the reducibility
  tag is the what-would-collapse-it field verbatim.
- **joints**: B0 (bot address) unblocks frame stamping; the ADVICE kind's
  members now have concrete shapes (selection functions, digest
  composers, template sets, echo generators, edge predicates).
- **guidance (IN)**: the no-mix law is now checkable both ways; ask
  templates never pre-fill A3; shared falsifier 3 (frustration names the
  refusing stage).

## 3. Owner-facing summary

- The bot already computes most of what a human co-player needs to see —
  which moves are still worth considering, what refutes the rest, why the
  chosen move pays, what it is unsure of and what would settle it — and
  today it throws that away every decision. The first build step is to
  keep it; it changes no behaviour and costs kilobytes.
- What reaches your eyes is selected under a budget you own: a handful of
  items per look, each a cause you can act on, never a wall of numbers.
  Everything not shown stays one tap away, so selection never becomes
  concealment. Alarms follow the discipline control rooms learned from
  their disasters: every alarm names the action it wants, nothing
  chatters, floods collapse to their first cause, and a safety alarm
  stays on screen until someone acknowledges it.
- Every piece of guidance you give gets an answer back: what your
  directive is doing, what it changed, and — when the bot is not doing
  what you asked — which of four specific reasons applies, so you know
  whether to push harder, re-aim, or take over.
- The bot tells you when its own knowledge has run out: when its proofs
  cannot separate the surviving moves it says so and asks for your call
  before showing its own coin flip — that is the moment your judgment is
  provably worth the most.
- Your reads on the opponent become a live channel with a track record:
  the bot shows how your hunches are scoring against what the enemy
  actually did, so trust between you and it is earned in both directions.
- The same reporting language covers the program itself: what each
  strategy is worth and where, what has actually been measured, where the
  blind spots are, and which decisions are waiting on you — briefed under
  the same few-items discipline as a live game, so the queue never again
  grows into a four-thousand-line file.

## 4. Standing risks (named, not dissolved)

- **Anchoring**: a good brief teaches the operator to see what the bot
  sees; the surface must measure its own distortion (override track
  record, doc 12) — and because the surface is a deployed ranker, every
  outcome row it produces is conditioned on its own selection: the
  selector logs exact exposure probabilities and keeps a small
  budget-charged randomised holdout from the first shipped frame
  (doc 13, librarian 43 co-adoption — correction needs propensities,
  identification needs uncaused rows, and neither can be retrofitted
  once every row is a caused row).
- **Retention custody** beyond game end, spectator/broadcast frames, and
  presentation-template governance remain open (doc 04 §9).
- The SET's native supplier (the set-valued reduction member) is designed
  and sized by theorem but unseated; until then the surface runs on
  reconstruction with a premise that says so (docs 04 §1, 09).
