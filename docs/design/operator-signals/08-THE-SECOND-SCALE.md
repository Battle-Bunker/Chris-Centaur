# 08 — The second scale: the landscape OF strategies

Ruling 51 says "what the bot knows about the strategy landscape". Docs
00–07 read that as the live game's strategic situation. There is a second
reading — the landscape *of strategies*: which members win where, what the
program has measured, where its knowledge runs out. The librarian's
one-index result says these are the same index at two scales (per-decision
and per-experiment, prior-art 29 §29.3), and the prior-art solver-explorer
family (06 §4) shows mature surfaces serving both. This document tests
whether the type system covers the second scale — and finds it does, with
one extension that is itself informative.

## 1. The experiment-scale signals, typed

| program knowledge | example (all real, from the pins) | shape |
|---|---|---|
| a cell verdict | "snake6 saturates at ≤500ms; the queen cell climbs through the top rung" | **HELD** (assertion + premise + invalidation: "until re-measured on a non-lineage member / new evalVersion") |
| a member's validation state | fold-k carries four provenance defects; potionOrdering win rides A2 incumbency | **HELD**, health field = the validation status vocabulary (validated / merged / in-collection, per the glossary) |
| a fitted profile | cpp/queen@v0, k=1.227 with the basis-march history | fitted **trace** member with F1/F2 provenance |
| a population finding | cyclicity flips sign snake vs piece boards; a single pooled rating is not a sufficient statistic | **HELD** whose premise is the population (lineage, density) — quoting it outside that premise is the crossing ruling 49 names |
| a coverage hole | tournament density 25%; no human game in any corpus; five of nine probe boards produce no columns | **WIDTH** at the experiment scale — see §2 |
| a measurement in flight | the rook forecast, registered, k frozen, awaiting rl5 | **HELD** (kind=hypothesis, invalidation = the scoring rule) |
| an instrument alarm | miner-refused unknown schema; conservation assertion tripped; a bounded statistic near its bound | **edge** — same rationalization law (a named operator action: fix the extraction) |
| a pending owner ruling | redaction defaults; sacrifice Option A/B; the measurement denominator | **ask** — see §3 |

The four shapes and two operators carry the scale unchanged. What changes
is the *anchor vocabulary* (cells, members, corpora, rosters instead of
units, plans, cells-on-board) and the currencies.

## 2. Experiment-scale WIDTH extends the removal taxonomy — a third currency

A coverage hole is a width: support = the unmeasured region of instance
space; and its removal lever is neither compute-this-turn nor an
observation nor an operator's knowledge — it is **run the experiment**,
priced in *batch resources* (games, sandbox nights, owner-authorized
rosters). So the removal enum at this scale is:

```
deduce | observe | ask | measure(batch-cost)
```

and `measure` is a third currency alongside quanta and attention, with the
same non-fungibility discipline: nothing converts batch nights into
operator attention or vice versa; the owner allocates batches, the
scheduler allocates quanta, the policy allocates attention. (The
experiment-queue and batch-roster machinery the program already runs is
this currency's ledger — it existed before this design and merely gets
named by it.)

`decisionRelevance` also transfers: a coverage hole is loud in proportion
to what filling it would *change* — "no potion-value measurement except k5"
was loud exactly because verdicts leaned on it. The experiment-scale
selector is the batch-roster prioritization the owner already does by
hand; the signal surface can compute the ranking's inputs (which holes
block which pending verdicts) even while the choice stays human.

## 3. The owner's decision queue is the experiment-scale ask surface

The pins' PENDING-OWNER items (redaction defaults, sacrifice A/B, ε
transport, the B5 decision) are asks in this type system: role=ask, HELD
payloads, each naming its affordance (a ruling), each with decision-
relevance (what is blocked), each moot-able (events can dissolve a pending
ruling — two of the time lens's three did dissolve). The ask hygiene from
the live surface transfers whole:

- an ask names what answers it (the specific ruling, with the options
  priced) — the "Needs your decision" bullets the joints lens already
  writes are exactly this presentation;
- mooted asks are excluded from "awaiting owner" counts (the dissolved
  rulings should not have sat in a queue);
- asks are selected under an attention budget — **the owner's attention is
  the scarcest currency in the whole program**, and the synthesis-pins file
  growing to 4,000+ lines is the flood mode this design exists to prevent.

That last point is the practical payoff: the aggregation laws (select,
digest-since-cursor, first-out bundles, furniture rule) describe what the
owner-facing reporting layer should have been doing all along. A
`digest(sinceRuling:51)` with facility-location selection over the
question space "what changed that bears on my open decisions" is a better
owner brief than any status page the program has produced — and it is the
same code path as the live operator brief with different anchors.

## 3½. The second scale's presentation templates exist now (value lens MEAS-4)

The value lens's reporting retrofit is, in this vocabulary, the second
scale's presentation-template set: **P(A beats B) with a stratified
interval** on every verdict (it exposed three of five standing verdicts as
coin flips), **performance profiles** for cross-cell comparison (the shape
a mean hides: territory broad-but-bounded, reflex's cliff), **IQM only**
for across-cell aggregates (the mean was 2.8× the median), and **seed
population as a premise coordinate** (pinned ≠ representative; the
0.427→0.530 spawn-geometry swing makes it load-bearing). Adopted here as
the HELD-payload presentation forms for cell verdicts and population
findings.

One scoping note this forces on my own rules: **"statistics never
headline" is a live-scale law, not a universal one.** At the second scale
the audience is deciding *between measurement programs*, and P(A beats B)
with its interval is exactly the honest headline — the Miller rule
governs explanations of *decisions in a game*, not summaries of
evidence. The two scales share shapes and differ in templates; that is
the templates doing their job.

## 4. What stays different, honestly

- **No realtime cadence.** Frames are per-session or per-batch; the
  obligation classes collapse to (decision-blocking, informative,
  archival). EmissionWindow, freshness-in-quanta, and the conformance
  tranche have no analogue — the second scale is pull-dominant.
- **The audiences differ and the redaction runs the other way.** Live
  frames are team-private against opponents; experiment frames are
  owner/program-internal, and *some must not reach live operators
  mid-game* if operators are ever adversarial parties (tournament
  integrity) — an open product question, recorded, not designed here.
- **Selection authority differs.** On the live surface the policy is the
  operator's; here the owner's ruling 52 IS the attention policy
  ("message only when it would change a decision"), which this lens obeys
  by pushing to the branch (the store) and messaging nothing (the frame)
  unless decision-relevant. The design describes its own communication
  protocol — taken as weak evidence it is the right shape.

## 5. Consequence for the mandate

The API in doc 03 is the live-scale instantiation. The second scale reuses
shapes, roles, aggregation laws, and ask hygiene with different anchors,
currencies, and cadence. Proposed statement for the eventual synthesis:
**one signal vocabulary, two scales of the one index, three currencies
(quanta, operator attention, batch resources), zero exchange rates.**
