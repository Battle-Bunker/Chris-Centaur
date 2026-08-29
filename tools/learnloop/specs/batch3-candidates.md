# Batch 3 — candidate experiment specs

**HAND-WRITTEN, AND NOT A GENERATED ARTEFACT.** `specs/batch2/` is emitted by
`bin/make-promotion-batch.js` from `promotion-ledger.json` and must be
regenerated rather than edited. This file is the other thing: a place for a
candidate experiment to be *specified in full* before anyone decides whether it
belongs in the ledger at all.

Nothing here is a ledger row. No status is moved, no measurement is recorded,
and no flag's `promotionMetrics` are edited by this file's existence. A
candidate graduates by someone adding it to `promotion-ledger.json` and
regenerating — this is the note that makes that a five-minute job instead of a
reconstruction.

---

## MS1 — `CENTAUR_MULTISTART_SEED`, flag on vs off

*The owner's search-seeding redesign: a literally random safe stage-0 baseline,
sampled multi-start hill climbing per cluster inside a slice of the decision
budget, and a weighted-random (softmax) selection among the combos found.
Built at `src/lobster/search/multistart-seed.ts`; per-engine override
`TeamDecisionOptions.multistartSeed`; parses `1|on|true` only; default OFF.*

### Status going in

**Never raced.** Offline only: a gate test asserting flag-off identity, a
stage-0 safety property, stage-1 budget and per-seed determinism, and a
regression on a packed-corner fixture built from the P7 pinning numbers. It has
no live evidence of any kind, and the case for running it is that it is the
direct replacement for a flag this programme has already rejected live.

### The question

`CENTAUR_CLUSTER_SEED` is REJECT on measurement, and the root-cause pass named
the mechanism precisely: **surrogate-basin capture.** The seed handed rung 0 a
de-conflicted plan that was simultaneously a local optimum of the single-unit
ascent and accident-free, so `selfInflictedPairs` and `contestedUnits` came back
empty, `pairRepair` and `jointPolish` did nothing, `perturb`'s single-unit moves
lost on the floor, and the 2000 ms search spent itself re-deriving one plan —
**improving slices 0.2% against 37%, from turn 1**. The team's opening geometry
was then decided by a surrogate with no term for the board edge, free space or
dispersion, and it walked into the corner: own-team separation **10.70 → 6.51**,
wall distance **3.95 → 2.00**, mean wall distance below 2.0 by median turn 5 in
**48 of 48** games against 5 of 48, and from that state collision deaths
**46 → 220** per 48 games.

So MS1 asks one question in two halves:

> **Does the multi-start restore the climb the search is budgeted for, without
> reintroducing the compression?** That is: does the improving-slice rate in the
> opening turns come back to the un-seeded arm's level, and do own-team
> separation and wall distance stay at or above it?

A null on placement with the climb restored and the geometry flat is a **pass**
worth carrying forward; a null on placement with the climb still dead is the
same failure wearing a new name.

### Arms

| arm | configuration |
|---|---|
| `ms-off` | baseline. Every flag at its shipped default. |
| `ms-on` | `CENTAUR_MULTISTART_SEED=1` |

Two arms, and deliberately not three. The temptation is to carry a `cl-seed`
arm for contrast; do not. The contrast already exists in P7 at the same cells
and the same seed sequence, the comparison that matters here is against the
UN-seeded arm, and a third arm buys a re-measurement of a rejected flag at a
third of the batch's box time.

**REQUIRES: both arms launched simultaneously**, on P7's 4×5-worker pattern.
P7 is the only experiment in the programme with weather symmetry by
construction and that is exactly why its rows are readable; every throughput and
slice-rate metric below is worthless without it.

### Cells — the P7 cells, with their standing caveats carried

| cell | role | caveat |
|---|---|---|
| `null-snake6` | **the readable cell.** Six trail units, trajectory-stable under zero treatment (A/A 44–45 of 48 games identical, paired turn-correlation +0.912 under a decision-preserving flag). The only P7 cell that resolved the seed's effect at all. | Runs at cap rate 0.917–1.000 in the un-seeded arm — a stall rather than play. The mechanism metrics below are non-placement measurements and survive that; `score` on this cell carries the standing uninterpretability caveat and must not be reported unqualified. A named long-cap snake cell would fix this and does not exist yet. |
| `snake5-knight` | **the piece-bearing falsifier.** It is what killed the board-level admission gate for the rejected seed: a piece board where that seed paid full price and bought nothing. | On the complete death breakdown this cell is flat, so it discriminates weakly. Carried as a falsifier, not as a scoring cell. |
| `headline-mix-king` | **description only.** | DISQUALIFIED as a scoring cell on measurement, not preference: under zero treatment its A/A pair agrees on game length in 5 of 48 games (turn-correlation −0.193) and flips 26 of 48 placements. It cannot resolve this effect at n=48. Include it only if the batch has box time to spare, and never score it. |

Blocks and games/arm should match the P7 pattern the comparison rests on
(16 blocks; 144 games/arm at three cells, 96 at two). N0 must floor every
scored statistic on every scored cell — batch 1's lesson, paid for twice.

### Mechanism metrics — what this experiment actually reads out

Placement is the *outcome* and is not the instrument. The four rows below are
the mechanism, they are what the P7 analysis measured, and they are what makes a
null interpretable instead of silent.

1. **OWN-TEAM SEPARATION.** Mean pairwise Manhattan distance between the
   subject team's heads, per turn, **controlled for survivorship** — only turns
   where both paired games still have the full roster alive, which is how
   10.70 → 6.51 was measured over 949 matched full-strength turn-pairs. A
   drifting mean over a shrinking team measures attrition, not formation.
   - *Expected under a pass:* flat against `ms-off`. The multi-start's objective
     carries no spacing, boundary or follow-the-tail term, so it has no
     mechanism by which to compress.
   - *Refuse the arm if:* separation falls by more than 1 cell. That is a
     quarter of the rejected seed's contraction and there is nothing in the
     design that should produce it.

2. **WALL DISTANCE.** Mean distance from the subject team's heads to the
   nearest board edge, per turn, same survivorship control. Report the **turn
   trajectory**, not the game mean: the rejected seed's signature is that
   `ms-off` bottoms out around turn 3 and **recovers monotonically** (3.20 →
   2.78 → 4.24) while the seeded arm falls monotonically and never recovers.
   Also report the headline count directly — **first turn at which team mean
   wall distance < 2.0, and in how many of 48 games it ever happens** (48/48 at
   median turn 5 under the rejected seed; 5/48 without).
   - *Note before reading turn 1 in isolation:* a uniform draw over safe moves
     loses wall distance near a corner as a matter of geometry — from a cell at
     distance 2 on the diagonal, two of four neighbours are at distance 1. A
     one-turn dip is not pinning. **Pinning is the monotone failure to
     correct**, and the recovery is the measurement.

3. **COLLISION DEATHS.** The full `ClashKind` vector, subject team, mined from
   replays: `contest`, `edge`, `bodyBlock`, `wall`, `self`, plus `exhaustion`,
   `hazard`, `sever`, `regicide`. **Not fatal stagings, and not a single key.**
   Report the COLLISION aggregate `{contest, edge, bodyBlock, wall, self}`
   beside the per-cause split, and reconcile the total against units lost
   (6 per game minus `finalUnits`) as an extraction check — that reconciliation
   is what closed `DEATH-CAUSE-SINGLE-KEY` and it costs nothing.
   - *The standing process finding this row exists to honour:* any future
     seed/ordering flag must be gated on a live cause-of-death breakdown, on a
     trajectory-stable cell, and never on offline fatal stagings. The rejected
     seed passed an offline gate at 41 → 0 and went 46 → 220 live on the same
     channel, a 4.8× miss on the exact quantity the gate measured.
   - *A/A floor:* the null pair moves the collision channel by ~2 units across
     48 games. Anything inside that band is noise and must be reported as such.

4. **REFUSAL RATE.** Two different things, both counted, and they must not be
   summed:
   - **Kernel refusals** — `ratchetRate` per decision, plus the emission-gate
     counters (`worth`, `rate`, `switch-floor`, `switch-dominance`,
     `ratchet-floor`, `ratchet-gap`, `nonconforming`). Read these knowing they
     are a LATE signal: under the rejected seed `ratchetRefusals` is 0.00
     through turn 60 and the "+103% plans with 10× refusals" shape first appears
     at turns 31–40, roughly thirty turns downstream of the pinning. A flat
     refusal rate in the opening turns is not evidence of health.
   - **Layer-internal refusals** — the multi-start's own report:
     `stage0Clean`, `stage0Conflicts`, `stage0Forced`, `stage0Coordinated`,
     `truncated` (pools the clock cut short), `samples`, `evaluations`,
     `spentMs` against `budgetMs`. A `stage0Forced` above zero means units with
     no survivable option; a persistently high `truncated` means the sampler is
     mis-sized for the box and its sample count should be re-derived, not
     quietly tolerated.

### The primary signature — and it is not on the list above

**IMPROVING-SLICE RATE IN THE OPENING TURNS.** Slices that produced a genuinely
better plan, as a fraction of slices, subject team, turns 1–5, at equal plan
counts. This is the causal telemetry: **0.2% under the rejected seed against
37% without it, visible on turn 1**, thirty turns before any refusal counter
moves. Everything in the mechanism list is downstream of it.

- *Gate:* **REFUSE THE ARM** if the multi-start's opening improving-slice rate
  is not restored to within the A/A band of `ms-off`'s. A seeding layer whose
  start the search cannot climb away from has reproduced the failure it was
  built to fix, and reporting that as a placement null would repeat the exact
  error P7 cost the programme.
- Report `plansEvaluated` per decision beside it, under the standing
  retirement: it carries a verdict ONLY with simultaneous launch AND a same-cell
  A/A floor for the same statistic. Batch 1's A/A pair swung it +65% under zero
  treatment.

### Two conditions the build already carries, which the arm should confirm live

Both come out of the root-cause pass and both are testable from the same run:

1. **Team-scale diversity.** Stage 0 re-draws every unit AND the order they are
   placed in, so the starts differ at team scale rather than by one unit —
   `perturb` is already a one-unit multi-start and is measurably useless here.
   Confirmed live by the seeding's own variance across the decision seed.
2. **The multi-unit repair operators stay armed.** Stage 0's common clause does
   NOT de-conflict (the safety floor and de-confliction are different things,
   and only the first is owed), and `jointPolish` additionally takes units from
   a room/dispersion gate rather than only from the resolver's accident report.
   Confirmed live by `pairRepair`/`jointPolish` engagement counts being non-zero
   in the opening turns on `null-snake6`.

### What must NOT be carried into this arm

The rejected seed's `EPS_FOLLOW` (+0.06 tail-follow bonus against a 0.05
ordering step). It took landings on a team-mate's freed tail from 0.3% to 26%
and converted a drifting formation into single file, which is why separation
fell rather than rose. It is an amplifier and not the driver — the lowest-follow
tercile of games is still pinned at wall 2.33 against 3.82 and still carries five
times the collision deaths — but it amplifies exactly this failure and there is
no version of this experiment in which adding it back is informative. The
multi-start's objective has no such term and must not gain one.

### Denomination

Every prior and every charge in this layer is in **weight units** — the material
lattice itself, where a unit of weight `w` dying is exactly `−w`. Heuristic
outputs tether to expected weight/score impact directly. Any readout that
introduces a second scale for these numbers is a readout to fix, not to
interpret.

### Also worth one line in whatever batch runs this

**`CENTAUR_EDGE_EV` composes with this arm and should not be entangled in it.**
The multi-start reads the edge-EV unary priors as its softmax weights where the
pass has run and treats every option as equal where it has not, so `ms-on` with
edge-EV off is the uniform-prior configuration and `ms-on` with edge-EV on is a
different experiment. Run MS1 with edge-EV at its shipped default and leave the
composition to a later joint arm; a feature folded into a neighbour's flag can
only ever be measured as a sum.
