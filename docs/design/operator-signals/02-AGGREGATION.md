# 02 — The aggregation algebra, and which folds kill the causal content

The owner's stress is on *intelligently aggregated* forms. This document
gives the aggregation operators, the three laws that govern them, and an
explicit table of which aggregations are lossy in ways that break the
standing flows law — because "aggregate intelligently" and "never sum flows
before caching" collide unless the collision is designed.

## 1. Three laws first

**AGG-1 (fold, never replace).** Every aggregate carries refs to its
constituents. An aggregate is an *entry point with drill-down*, never the
record. The complete-internally half of M27 applied to aggregation: the
constituents must remain addressable after the fold, or the fold is a
destruction. Concretely: a digest names the edges it folded; a rollup names
the flow records it summed; a map cell names its contributors.

**AGG-2 (anchors are the causal grain).** A FLOW record's causal content
lives in its anchors: (account, channel, event). Folding **along time
within fixed anchors** preserves causality (a balance movement per (unit,
channel) is still a cause: "the queen leaked 6 weight to the corridor
contest over 4 turns"). Folding **across an anchor dimension** deletes that
dimension's vocabulary:

| fold | result | causal status |
|---|---|---|
| over events, within (unit, channel) | balance delta per channel | causal — still names the mechanism |
| over channels, within unit | unit's net movement | semi — names the patient, not the mechanism; entry point only |
| over units | team statistic | **not causal** (Miller finding 3) — legal for ordering/coloring, banned as explanation, banned as the cached record |
| over channels AND units | the aggregate score | the exact thing the standing law exists to keep the surface off |

**AGG-3 (premise discipline survives aggregation).** Two values in
different fibers never fold silently: an aggregate over mixed premises
first joins (widens) and is labeled by the joined premise. Bites hardest
on: margins across decisions (each decision's margin lives at its own
premise; a session-mean margin under a changed evalVersion is the silent-
comparison disease with a UI), floors across bases, curves across CPP
members. The digest that spans an evaluator-version change *segments* at
the change and says so.

## 2. The operators

```
select(items, policy)            attention-ranked selection (the ADVICE law) — §3
digest(cursor)                   temporal fold since a cursor — §4
rollup(FLOW*, by, window)        fold along declared anchor dims (AGG-2 grades the result)
map(σ*, board)                   spatial rollup to cells, contributors ref'd (a rollup with by=cell)
delta(σ, cursor)                 diff of one signal against a cursor state
squeeze(trace)                   (saturationPoint, position, slope) — the curve as three numbers, curve pullable
contrast(SET, a, b)              the foil projection (defined in 01 §2.1; listed here as the SET aggregation)
```

None mints a new shape: `digest` and `delta` return edge-sets + graded
rollups; `map` and `rollup` return FLOW/WIDTH aggregates with refs;
`squeeze` returns a trace summary. The algebra composes:
`select(digest(sinceLook), policy)` is "the intelligent since-you-looked
brief", and it is the single most important composite on the surface.

## 3. select — the one aggregation that is the surface's law

The ADVICE kind's composition law, applied: a value over *sets* of items,
monotone submodular, greedy under an attention budget.

**The value function, concretely — facility-location form.** (Corrected in
cycle 4: my first draft scored `Σ relevance(i) × novelty(i | shown)`, which
is not monotone — adding an item can lower the total through others'
novelty. The standard coverage form is both monotone and submodular, and it
is also the honest model of what a briefing is *for*.)

Let Q be the question space: (anchor, question-kind) pairs — ("queen",
safety), ("staged plan", why), ("clock", worth-more-thinking), … Each item
covers some questions with some quality:

```
value(shown) = Σ_{q ∈ Q}  weight(q) × max_{i ∈ shown} answers(i, q)

weight(q)     relevance of the question NOW, in weight units where possible:
              margin-at-stake (SET questions), decisionRelevance (WIDTH),
              rate × horizon (FLOW), health-degradation (HELD)
answers(i,q)  ∈ [0,1] — how completely item i answers q; an item may
              answer several questions (a coincidence bundle answers three)
```

`max` is where the submodularity lives (a question already answered well
gains little from a second answerer — two items on "is the queen safe" are
near-substitutes), and it is provably monotone submodular, so greedy
carries the (1−1/e) guarantee and — more importantly — is incremental: one
more attention unit = one more greedy step, so the budget is genuinely a
dial, not a re-plan. The question space is small and generated (anchors ×
a fixed kind list), not authored per decision.

**The bottom element (humans always win).** The selection meet has the
operator's own subscriptions as its bottom: a **pinned signal class is
delivered off-budget, always**; a shelved class is suppressed until its
shelf expires (03 §2 — suppression always has an expiry; hard-soundness
edges are unshelvable, the one paternalism this surface keeps, because a
soundness break invalidates every other signal shown). The scheduler never
overrides either direction: the budget governs only the unpinned,
unshelved middle.

**Asks are selected, not queued.** An ask enters the same selection with
its role's price multiplier (an ask costs more attention than an offer of
equal payload, because it demands a response). Horvitz's expected-value
test is then automatic: an ask surfaces exactly when its decisionRelevance
clears the inflated price against the competition. No separate ask-throttle
mechanism exists.

## 4. digest — the temporal aggregation

`digest(cursor)` folds everything since a cursor into: (a) the edges that
fired, (b) graded rollups of flow movement, (c) HELD health changes, (d)
current squeezed traces. Three cursors, three products:

| cursor | product | typical question |
|---|---|---|
| `sinceLook` (attention cursor: last frame this operator was shown) | the brief | "what happened while I watched another snake" |
| `sinceCommit` (action cursor: this operator's last intervention) | the consequence report | "what did my pin / my commit change" — delta-since-last-commit is `digest(sinceCommit)` filtered to items citing the intervention's HELD ref |
| `sinceTurn` (game cursor) | the turn note | the turn-boundary summary; the one that ADVANCE transports |

Design decisions:

- **The furniture rule** (doc 06 §3): an edge item re-selected for N
  consecutive frames converts to a HELD — it has become a *condition*, not
  an *event* — and stops costing alarm-class attention; its clearing is
  itself an edge ("the standing threat lifted"). This is the standards'
  stale-alarm discipline, and it is what keeps a long siege from pinning
  the same threat item at the top of every frame for thirty turns.
- **Digests fold edges, not states.** Edges are discrete and concatenable;
  `digest(a→c) = digest(a→b) ⧺ digest(b→c)` up to re-selection. States are
  re-read fresh. This is what makes cursors cheap and idempotent.
- **A digest is bot-composed, client-dumb.** The platform's decision-
  transparency rules (published-slots-only, no client recomputation,
  consumers forbidden to diff-merge) mean the client cannot compute a
  digest from history — so the digest is computed engine-side against the
  operator's cursor and delivered as a slot in the frame (doc 03). The
  cursor is the one thing the client sends up.
- **Digest selection is the same `select`**, with the budget scaled by gap
  size (a longer absence buys a slightly longer brief, sublinearly — an
  hour away does not earn a hundred items).

## 5. The lossy-aggregation table (what breaks the flows law)

Explicit, because these are the aggregations a well-meaning UI builder
reaches for first:

| tempting aggregate | why it breaks | the lawful replacement |
|---|---|---|
| a per-plan "score" column summed over channels+units | the aggregate-score surface; zero causal content; and it silently crosses the proved/advised split | floor (proved, basis-tagged) + top-2 flow citations per plan |
| a per-enemy "threat score" | sums heterogeneous predicates; unexplainable and premise-mixed | threat **map** with contributor refs, or the top edge per enemy |
| mean margin over the last N decisions | cross-fiber average (AGG-3); margins live at their own premises | margin trace, segmented at premise changes |
| "confidence %" on the staged plan | invents a probability the machine does not hold; launders quantifier-grade and weight-grade content into one number | the SET: cardinality + the deciding margin ("2 options within 3 weight") |
| win probability | same, worse — and it is the statistic Miller finding 3 says persuades least | share state (K, W, p) with its flow trend, per team |
| caching any of the above as the stored record | the memo-boundary destruction (C14/R-2): once stored summed, the causes are unrecoverable | store constituents; fold at read (the blend-at-read Law B, applied to aggregation) |

The last row is the deepest: **every lawful aggregate here is a read-time
fold**. The store keeps shapes; folds happen at frame assembly, per
operator, per cursor. That is what makes the same store serve a glance, a
brief, and a post-game audit without three pipelines. It is also Law B
(blend-at-read) arriving on this surface for the same reason it exists in
the comparator: a stored blend cannot be un-blended.

## 6. Aggregates that are genuinely new information (not just folds)

Two aggregation products add content beyond their constituents, and both
earn their place:

- **The verdict of a trace** — "saturated" vs "climbing" (squeeze's slope
  classified against the CPP member's noise floor). It converts a curve
  into an actionable sentence ("more time will not change this move" /
  "the bot is still finding things — hold your commit"), and it is the
  single most operator-useful product of the whole time lens. Commit-timing
  advice (joints B5) is this verdict plus the clock.
- **Cross-signal coincidence** — an edge bundle whose members cite one
  event ("the reveal collapsed the cloud AND flipped the staged plan AND
  invalidated your pin" — one cause, three effects). Assembled by matching
  event anchors across simultaneous edges; presented as one item with
  three drills, costing one attention unit instead of three. This is where
  "intelligently aggregated" pays hardest, and it is a pure join on
  `EventAnchor` — cheap because the anchors were kept (AGG-2's dividend).
  When sub-step structure gives the anchors a causal order, the bundle
  leads with the initiating event (first-out alarming, doc 06 §3): "the
  reveal" headlines; "plan flipped" and "pin invalidated" are its
  consequences, not peers.
