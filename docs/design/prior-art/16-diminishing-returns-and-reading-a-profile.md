# PRIOR ART 16 — diminishing returns, and how to read a performance profile

Domain: written in direct response to the TIME lens's first compiled conditional
performance profiles (`cpp/*.json`, tip `659ea43`: *"snake6 saturates at 500 ms,
queen climbs through top rung"*) and to domain 7's C24 (the Tron winner's claim
that a better evaluation always beats a deeper search).

Short, and aimed at one question: **a saturating profile is not
self-interpreting, and the chess literature says exactly why.**

---

## 16.1 Load-bearing sources

**S38. Junghanns, Schaeffer et al., *Diminishing returns for additional search in
chess* (ACC 8, 1997).** The measurement of the effect and the analysis of why it
was hidden for fifteen years.

**S39. Thompson, *Computer chess strength* (1982)** — BELLE at depth *d* scoring
~80% against depth *d−1* across 4 ≤ d ≤ 8, the result that started the argument.
**S40. Ferreira, *The impact of the search depth on chess playing strength*, ICGA
Journal 36(2) (2013)** — the modern re-measurement on a strong engine.

---

## 16.2 What the experts found

- **The gain per doubling is not constant and it decays.** Thompson's ~80% per
  ply (≈200 Elo) held at shallow depths; the modern measurements give ~90 Elo per
  ply around depth 10 and ~70 around depth 20, with commonly-quoted figures near
  ~66 Elo/ply and a geometric decay in the increment. The debate lasted fifteen
  years because, as the later analysis put it, **the high error rate of programs
  through ~9 ply hid the effect**: a weak evaluator makes so many mistakes that
  extra search keeps finding cheap ones, which looks like constant returns.

- **The interaction with evaluation quality is the part that transfers.** The
  standing summary in the chess-engine community: *"an engine with a very good
  positional eval will already have a good resolution of scores at low depth, and
  will not benefit nearly as much from extra depth as one with poor positional
  knowledge."* And the knowledge-vs-search result: once a knowledge gap has been
  opened, *"it cannot be overcome by small increments in searching depth"* —
  a knowledgeable program beats a less knowledgeable one at equal depth almost
  always.

---

## 16.3 Mapping onto our joint

**C48. A saturating CPP has two opposite diagnoses, and the profile alone cannot
tell them apart.** The time lens's v0 result — snake6 saturating at 500 ms while
the queen board climbs through the top rung — admits two readings:

  - **(a) the search has extracted what is there**: the position is resolved, and
    further quanta buy nothing. Remedy: shorten the contract, spend the remainder
    elsewhere (which is the "fund ponder" conclusion, and it is right *under this
    reading*).
  - **(b) the evaluator is too coarse for extra depth to bite on**: the leaf
    values do not separate the plans being compared, so deeper search returns the
    same ordering. Remedy: **fix the evaluator**, and the saturation will lift.

  The chess literature says (b) is the historically dominant explanation early in
  an engine's life and that it *masquerades* as (a) — and our own evidence points
  at (b) on exactly the board that saturates: the VALUE lens measured the shipped
  evaluator as weight-blind (`captureRank` ranks a weight-31 queen capture
  identically to a weight-2 snake), `room` mis-scaled ~15×, and the three-team
  balance definitionally wrong. That snake6 saturates while the *queen* board —
  where a single high-weight account dominates and the evaluator therefore *does*
  separate plans — keeps climbing is precisely the pattern reading (b) predicts.
  **This is a live alternative interpretation of the programme's first CPP result
  and it should be resolved before the profile is used to reallocate budget.**

**M47. The discriminator already exists as a proposed telemetry column, and it is
the same column three other findings want.** The chess community's diagnostic for
(a) vs (b) is *score resolution*: how much the evaluation spreads across the
candidate moves at a given depth. Near-zero spread ⟹ reading (b). In our terms
that is **the margin at the deciding rung**, i.e. the VALUE lens's M2
(point-of-comparison feature spread, by unit class) and my README item 2
(`(runner-up plan, deciding rung, margin)` for the top-k).

  So: **the CPP's second axis is the margin distribution.** Compile
  `Pr(quality | quanta, premise)` *and* `Pr(margin at the deciding rung | quanta,
  premise)`; where quality saturates and margin is wide, the search is done;
  where quality saturates and margin is near zero, the evaluator is the binding
  constraint. That single addition turns the CPP from a budgeting table into a
  diagnostic instrument, and it costs nothing extra because the column is already
  wanted by three other findings.

**M48. The saturation point is the contract length, and the literature says it
moves.** Once the profile is read correctly, the optimal contract for a stratum
is where the marginal quality per quantum falls below the value of spending it
elsewhere — which is Zilberstein's compilation problem (domain 2) with a real
profile at last. The caution from this literature: **the saturation point is a
function of the evaluator**, so it must be recompiled whenever the evaluator
changes. That is an argument for the evaluator version already being in the
declaration record, and for the CPP being keyed on it — a profile compiled under
`evalVersion` *v* is not valid for *v+1*, and using it would be exactly the
silent premise crossing the composition lens exists to refuse.

**M49. C24 gets its citable form and its scope.** a1k0n's claim ("a better
evaluation heuristic will always beat deeper minimax searches") is the strong
version; the chess literature's version is more precise and more defensible:
*once a knowledge gap has been opened, it cannot be overcome by small increments
in search depth*, and *a better evaluator reduces the benefit of extra depth*.
Both point the same way for us, and both are testable with the experiment the
composition lens already specced (hold ε and the evaluator fixed, vary `plyCap`)
— now with a fourth hypothesis attached and a discriminator (M47) that separates
them.

---

## 16.4 Verdicts the lens agents can act on

- **TIME (act on this before the v0 profiles are used to move budget):** a
  saturating CPP has two opposite diagnoses — "search exhausted" and "evaluator
  too coarse to reward search" — and the profile alone cannot distinguish them.
  The chess literature says the second historically dominates and *masquerades*
  as the first, and our own evaluator measurements point that way on the board
  that saturates. Compile a **second axis: the margin at the deciding rung**.
  Wide margin + saturation ⟹ search done. Near-zero margin + saturation ⟹ the
  evaluator is binding, and the "fund ponder" conclusion inverts.
- **TIME / COMPOSITION:** **key the CPP on `evalVersion`.** The saturation point
  is a property of the evaluator, so a profile compiled under one evaluator is
  not valid under another; reusing it is exactly the premise crossing the refusal
  law exists to catch, and the coordinate is already in the declaration record.
- **VALUE:** your M2 instrument (point-of-comparison spread, by unit class) is
  also the time lens's profile discriminator and also the contrastive-explanation
  column and also the VOI input. Four consumers, one column — that ratio should
  move it to the top of your build order.
- **OWNER-FACING:** the numbers, for calibration: ~200 Elo per ply at shallow
  depths decaying to ~70 by depth 20; the effect was invisible for fifteen years
  because weak evaluators keep giving deeper search cheap mistakes to find. Our
  evaluator is measured as weight-blind on the unit that decides the game. The
  cheap experiment that separates the readings is already specced.
