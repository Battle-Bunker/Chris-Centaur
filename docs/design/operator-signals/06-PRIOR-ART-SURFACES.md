# 06 — Prior art: expert operator surfaces, mapped onto the type system

Ruling 50: inspect expert implementations. Four families of mature
bot→human surfaces exist; each validates part of the design and two of
them correct it. Sources: UCI protocol practice (chess engines/GUIs),
KataGo's analysis engine (JSON API: `AnalysisResponse`/`MoveInfo`,
verified against current field lists), the process-industry alarm
standards (ISA-18.2 / IEC 62682 / EEMUA 191, via current practitioner
summaries), and solver-explorer surfaces (poker). Amendments this pass
forces are consolidated in §5 and applied to docs 01–03.

## 1. Chess engine protocol (UCI) — the oldest live SET surface

What UCI ships: `MultiPV` (the top-k lines — a SET without dominance
conditions), `score cp|mate` with **`lowerbound`/`upperbound` flags** (a
half-present proved-vs-advised distinction), `depth/seldepth/nodes/nps`
(trace axes), `currmove` (liveness), `ponder`/`ponderhit` (the
anticipatory meet, 25 years old). Verdicts:

- **MultiPV validates the SET as the spine** — every serious analysis GUI
  is built on it, and eval-graph-over-time is trace(SET) — but UCI's k is
  a display constant, not a dominance boundary: the set does not shrink as
  the engine learns, so it is not a progress meter. Our undominated set is
  the corrected form.
- **UCI has no premise.** Scores arrive bare; which network/contempt/
  hash-state produced them is unrecoverable, and GUIs routinely graph
  incomparable numbers across engine restarts — the silent-comparison
  disease, shipping in every chess GUI for two decades. The premise ref is
  the fix UCI never got.
- **The Stockfish exhibit for the flows law**: classical Stockfish's
  `eval` trace printed per-term, per-piece contributions (a FLOW surface);
  the NNUE transition collapsed evaluation into an unexplainable scalar
  and the trace lost its causal content. Strength went up, explanation
  went to zero — proof that the causal vocabulary must be an architectural
  requirement (retained records), not a hoped-for by-product, because the
  first strength-motivated refactor will otherwise delete it.

## 2. KataGo's analysis engine — the richest statistics surface, and Miller's counter-exhibit

`MoveInfo` carries ~23 fields per candidate (winrate, scoreLead,
scoreStdev, lcb, utility, prior, visits, order, pv, per-move ownership);
`AnalysisResponse` adds root info, board-wide `ownership` +
`ownership_stdev`, `policy`, and **`isDuringSearch` partial results**
(anytime frames — our seq/freshness, shipped). Verdicts:

- **Ownership maps validate the map aggregation** (02): per-cell expected
  control with a stdev channel is exactly a threat/territory map — but
  KataGo's has no drill-down: a cell's ownership cites nothing. Ours keeps
  contributor refs (AGG-1). Their `ownership_stdev` also seconds the value
  lens's KataGo-gap note (variance channel missing from our fold) — when a
  variance term exists, WIDTH carries it; the surface schema needs no
  change.
- **`scoreStdev` beside winrate** is the field practitioners actually
  read on close positions — evidence that operators want width, not just
  point estimates, seconding WIDTH as a base shape.
- **The counter-exhibit**: KataGo's surface is *pure statistics* — the
  best-instrumented game AI in the world emits winrates, priors and
  stdevs, and human reviewers still need a strong player to say *why* a
  move is good. Miller's finding 3, live at scale: statistics without
  causes explain nothing. Our FLOW citations and foils are precisely what
  this surface lacks; its popularity is not evidence statistics suffice —
  review tooling on top of it (which humans built because the raw surface
  fails them) re-derives causes by hand.

## 3. Process-industry alarm management (ISA-18.2 / IEC 62682 / EEMUA 191) — the discipline our edge system was missing

The one mature engineering literature on *not* flooding a human operator,
written in the blood of Milford Haven, Buncefield and Texas City. Its
mechanisms, mapped:

| standard's mechanism | our design | verdict |
|---|---|---|
| alarm philosophy + **rationalization** (every alarm justified against cause / consequence / **defined operator action** / priority, in a master database) | edge predicates are manifest members | **adopt as a law**: no edge class without a named operator action (§5 A1) — an alarm nobody can act on is ambient telemetry, not an alarm |
| priorities with response expectations; target priority distribution (few high, mostly low) | obligation classes (03 §4) | validated; add distribution telemetry per predicate member (§5 A5) |
| **shelving** (temporary suppression with a max shelf life, then auto-return) | my `mutes` were permanent | **corrected**: mutes become shelves with expiry (§5 A2) |
| state-based suppression (alarms inhibited by plant state; aviation's phase inhibits) | `voidIf` covers item death but not class inhibition | adopt: edge classes may declare turn-phase inhibits (e.g. commit-timing advice suppressed after commit) — data on the predicate member, not code |
| chattering / deadband / on-delay | nothing — posture flapping would chatter | **corrected**: edges get hysteresis declarations (min dwell before fire, deadband on scalar predicates) (§5 A3) |
| **first-out alarming** (identify the initiating cause in a cascade) | the coincidence bundle (02 §6) | adopt the causal refinement: the bundle is ordered by the event-anchor's causal order when sub-step structure gives one — the bundle *leads* with the first-out |
| **stale/standing alarm** reports (alarms active so long they are furniture) | HELD health has no "furniture" state | adopt: an edge item re-selected for N consecutive frames converts to a HELD (it is now a *condition*, not an *event*) and stops costing alarm-class attention (§5 A4) |
| flood metrics (≤ ~1 alarm/10 min normal; 10+/10 min = flood; <~150/day manageable) | budget bounds items/frame but not edge rates | adopt flood mode: when the edge rate exceeds the declared band, the frame degrades to bundles + counts by class, never a scroll of items (§5 A6). Numeric targets do **not** transfer (their decision tempo is not ours) — the *existence* of a declared band and a flood behaviour transfers |

This family is the strongest single import of the pass: our aggregation
design had selection right and **temporal alarm hygiene absent**.

## 4. Solver explorers (poker) — the WIDTH-first surface

Modern solver tooling (range explorers) presents: the full strategy
*distribution* per decision (action frequencies per hand class), EV per
action, and aggregate reports across board runouts. Verdicts (kept
general; no field-level claims):

- Validates presenting **mixtures and margins rather than verdicts** where
  the underlying object is set-valued — and our restricted-gap result
  (pureDuality = 0 on every contacting board measured) means we can ship
  the *simpler* pure-saddle presentation and state it as a premise, where
  poker tools cannot. When pureDuality > 0 ever appears live, the SET
  payload already carries what a mixing display needs.
- Validates **aggregation across instances at the experiment scale**
  (their aggregate reports = our per-cell instrument tables): the
  per-decision and per-experiment scales of the index really do want
  different surfaces — seconding prior-art 29's two-scale distinction.

## 5. Amendments applied (edits to docs 01–03 in this commit)

- **A1 (rationalization law, → 01 §3, 03 §6)**: every edge-predicate
  member declares `operatorAction: AffordanceId | 'awareness'`; a
  predicate registering with 'awareness' may never carry a class above
  `ambient`. The ISA rationalization question — "what will the operator
  *do* with this?" — asked at member registration, once, instead of never.
- **A2 (shelving, → 03 §2)**: `mutes` → `shelves: [{class, until}]`, with
  a policy-level default shelf life; expiry restores delivery; soundness
  classes remain unshelvable.
- **A3 (hysteresis, → 01 §3)**: edge declarations carry optional
  `{minDwell, deadband}`; the posture-shift and floor-band predicates ship
  with both. Chatter is suppressed at the predicate, not by the selector
  (a chattering edge consuming novelty budget would starve real items —
  the selection law cannot see chatter, only redundancy).
- **A4 (furniture rule, → 02 §4)**: an edge item surviving N frames
  becomes HELD (condition, not event); its return to normal is itself an
  edge ("the standing threat cleared").
- **A5 (distribution telemetry, → 04 open questions)**: per-predicate
  firing rates and class distribution as a standing store query — the
  audit that finds bad-actor predicates, per the standards' top-10 lists.
- **A6 (flood mode, → 03 §4)**: a declared per-class rate band; above it,
  frame assembly degrades to first-out-led bundles with counts. The band
  is a member with provenance like every other constant (ruling 49 —
  nothing transfers from process plants but the shape).
