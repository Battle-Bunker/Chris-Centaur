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

---

## W1 — the weight ladder: every positional weight scaled together, ×1 / ×2 / ×4 / ×8

*From the 2026-08-29 scoring-alignment audit, §4.7 and the owner verdict's last
bullet. The audit's finding is that the ten-to-one ratio between `material` and
every positional term in `src/lobster/evaluate/calibration.ts` was **chosen**,
not fitted, and that several load-bearing documents then quoted its arithmetic
consequences back as facts about the game. Of the whole ordering channel exactly
one number — `reach = 1` — has ever been validated by a live outcome, and only
against zero. This is the experiment that stops that being true.*

### The question

E3 measured what happens when the ordering channel is scaled as a block: the
first overturn of a clear material verdict appears at **≈4× (3 of 8,878
decisions, 0.034%)** and 8× yields **23 (0.26%)**; per-position margin median
6.90, p05 2.57, min 1.76. Below 4× a uniform raise is a pure
re-parameterisation — the ordering is Kendall-τ identical — so the informative
arms are **k ∈ {2, 4, 8}, and not {1.1, 1.5}**.

> **Does letting positional evaluation outbid material buy games, and where?**

`k = 2` is the declared null: E3's arithmetic says the tie sets do not change,
so an effect there is an instrument fault and must be chased as one before
anything else in the batch is read. `k = 4` is the first regime in which the map
DISAGREES with material at all. `k = 8` is where the disagreement is frequent
enough (0.26% of decisions ≈ 0.4–2 overturned decisions per game) that a
mechanism channel can see it.

### Arms

| arm | configuration |
|---|---|
| `w-k1` | baseline. `TERRITORY_PROFILE`, shipped weights, every flag at its default. |
| `w-k2` | every positional weight ×2 |
| `w-k4` | every positional weight ×4 |
| `w-k8` | every positional weight ×8 |

**ALL of them, together, and `material` is not one of them.** The scaled set is
`{reach, room, healthEconomy, kingMargin, command}` — every weight in
`DEFAULT_WEIGHTS` except `material`, which stays at 10 and is the fixed
denominator the ladder is measured against. This is a deliberate departure from
the audit's own §4.7, which proposed excluding `reach` on E3's decomposition
(`room` and `healthEconomy` own the spread; `reach` is ~5% of it). Excluding it
would make the ladder a *different* map at every rung and would answer a
question about `room` rather than the owner's question, which is about the ratio
itself. The per-feature ladder is a **follow-up**, and it is only worth running
if the block ladder moves something.

Four arms is expensive. If box time forces a cut, drop `w-k2` and keep
`{k1, k4, k8}`: k2's job is to falsify the instrument, and it can be recovered
from the A/A null plus E3's τ argument at a pinch. Never drop `k1` — a ladder
without its own base is three unpaired numbers.

### What has to be built before this is schedulable

The selection seam is a harness act and carries zero production risk
(`TeamDecisionOptions.evaluate`), but it is not free:

1. **Three new exported evaluators** on `claude/cluster-lookahead`, beside
   `territorySliderEvaluator`: `territoryK2Evaluator`, `territoryK4Evaluator`,
   `territoryK8Evaluator`, each a `CriterionProfile` whose weights are the
   shipped ones with the five positional terms multiplied. A weights diff and
   nothing else — no feature changes, no fold changes.
2. **Three new bot names** in `tools/simworker/harness/lib/bots.ts` on
   `sim/worker-kit`, seated through `evaluatorNamed(...)` exactly as
   `lobster-slider` is. A bundle built from a branch without the export fails
   by name, which is the behaviour that seam already has and wants.
3. **`--subject-map` on every aggregation.** The arms legitimately seat
   different BOT NAMES in the subject seat, so the integrity gate needs
   `--subject-map w-k1=lobster-territory,w-k4=lobster-k4,…` or it will refuse
   the pairing. This is the same declaration I2's slider arm already needs.
4. **THE CLIFF LAW MOVES, AND IT MOVES AS ONE DECLARED CHANGE.** At k ≥ 2 the
   inequality `w_feature × range < 10 × lightest unit weight`
   (`calibration.ts` `CLIFF_MATERIAL_WEIGHT`) is breached BY DESIGN — that is
   what the experiment is. It lives in four places and they must move together
   or the arm will not run: the inequality itself, `nonMaterialSpan` in
   `search/edge-ev.ts`, `clampToLat` in `search/scout/scout.ts`, and the
   assertion in `src/tests/territory-acceptance.test.ts`. The scaled profiles
   must carry their own declared span budget rather than silently failing the
   shipped one. (Note the standing gap while you are there: that acceptance
   test covers `reach` and `room` only; `healthEconomy` and `kingMargin` are
   39% of the ordering budget and are untested.)

### Cells — three families, chosen for what each can falsify

| cell family | role | what a move there means |
|---|---|---|
| snake-dense (`null-snake6`, `r01-snakes6`) | **territory's win regime.** The profile already wins here: +0.50 saturated on 6-snake, 24/24 firsts snake-only. | The predicted NULL. E3's arithmetic plus live saturation says k-scaling buys nothing where the map is already at ceiling. A k-arm that *loses* here is the cliff earning its keep, and that is the finding. |
| slider / piece (`snake5-queen`, `snake5-knight`, `sliders23`) | **the repair regime.** This is where the positional features were measured to carry literally zero gradient (reach spread 0.0000–0.0076 over a slider's own 71 actions) and where the `command` term repaired it (+0.312 at 1000 ms). | The predicted PLACE FOR AN EFFECT. If the owner's "under-weighted positional heuristics" is true, it shows up as k4/k8 beating k1 SPECIFICALLY here, through `command`. |
| `headline-mix-king` / the big13 shape (25×25, 3 teams × 6) | **the owner's headline board**, and the one open live contradiction: territory −0.75 against material +0.25 while commanding 13.0 units to legacy's 3.5, n = 8, unresolved. | Description only until CELL-QUALITY is closed. This board flips 26 of 48 placements between two builds of the SAME commit; it cannot score this effect at n = 48. Carry it, mine it, do not score it. |

Sized on the standing rule: **16 blocks minimum for any placement claim**, and
the ledger's own arithmetic (80% power at MDE 0.25 needs ~58 blocks pooled;
MDE 0.10 needs 362–1,447). At the block counts this programme can actually
afford, **placement is descriptive and the mechanism rows are the result.**
Say so in the write-up before the numbers, not after.

### Readouts — and BOTH outcome currencies, which is half the point

The audit's §1.4.2: the harness's graded placement `score` pays a clean 2nd of 3
half a point and **TacticToes pays nothing for it.** Every non-winning team
scores 0, so winner(s) place 1st and all losers tie 2nd. So:

- **`pFirst` — P(first), outright or joint.** THE GAME'S REWARD, and the primary
  outcome row for this experiment. `aggregate.js` emits it beside `score` (and
  under its historical key `win`, which is the same number; the ledger and
  `verify-null.js` still speak that name).
- **`score` — the graded placement.** The more sensitive instrument, answering a
  question the game does not ask. Report it, and when the two part company say
  which one moved and which way.
- **Mechanism, and it is primary:** deaths by cause (the full nine-`ClashKind`
  vector, subject team, reconciled against units lost), **sever material lost
  and dealt** — the largest identified material channel with no dedicated
  feature, 3× the kill channel by mass and untracked — food landings and
  eats/game, and `ratchetRate`. A k-arm that trades food for space is only
  attributable if the trade is on the row.

### The null hypothesis, stated in advance

E3's arithmetic plus the live snake-board saturation predicts: **k-scaling buys
nothing on snake boards (already at ceiling) and acts, if anywhere, on piece
boards through `command`.** If instead the k > 1 arms bleed everywhere, the
cliff was load-bearing, and the answer to the owner is *depth first, weights
second*, with receipts. Both outcomes are results and both must be written up as
one; the failure mode to avoid is running four arms and reporting only the
comparison that moved.

### What this experiment does NOT settle

Depth. `chosen.horizon == 1` in all 132 budget-ladder games at every budget, so
a positional advantage that cashes out over six turns is invisible at any
weight setting. The weight ladder and the depth programme are in **series**, not
in competition, and this arm answers only the second of them.

---

## MW1 — `CENTAUR_MUTUAL_WIPE_AWARD`: an engagement question first, and an outcome question maybe never

*The audit's one hard alignment bug, now repaired dark on
`claude/cluster-lookahead`: TacticToes settles a game in which every remaining
team dies on the same turn from the PREVIOUS COMMITTED TURN's board, so a team
ahead on weight that trades its last units for its rival's last units WINS. The
shipped ordered terminal clamps price that world as the lattice bottom and
refuse it. `src/lobster/evaluate/mutual-wipe.ts` models the real rule behind a
flag, OFF by default; `tools/simworker/harness/lib/match.ts` was adjudicating the
same end kind as a shared first and now adjudicates it on the previous turn's
weights too.*

### THE BASE RATE, MEASURED — read this before designing anything

Mined over every manifest in the programme's results tree (333 `manifest.jsonl`
files, **13,245 game rows**, 2026-08-29):

| end kind | rows | share |
|---|---|---|
| `cap` / `turn-cap` | 8,464 | 63.9% |
| `last-team-standing` | 4,771 | 36.0% |
| **`all-eliminated`** | **10** | **0.076%** |

That is **0.21% of the 4,781 decisive games**, and 1 game in ~1,325 overall.
By cell, and every one of the other 110 cells in the corpus is a zero:

| cell | all-eliminated / games | rate |
|---|---|---|
| `haz-none` | 1 / 24 | 4.2% *(n=1 event; not a rate)* |
| `pot-mod-e3` | 1 / 60 | 1.7% *(n=1 event)* |
| `sliders23` | 1 / 156 | 0.64% *(n=1 event)* |
| `s3-mix23-base` | 1 / 573 | 0.17% *(n=1 event)* |
| `headline-mix-king` | 4 / 2,928 | **0.137%** |
| `null-snake6` | 2 / 2,904 | **0.069%** |

Only the last two have enough events to be called rates at all. The ten rows are
**7 distinct games** (three appear twice, in two arms of the same batch), and
every one of them is a 3-team game. Re-adjudicating those 7 on the previous
turn's weights — which is what the harness fix now does — turns **6 into a
decisive result** and leaves **1 a genuine tie** (4 against 4 on
`null-snake6`). Under the old rule all 7 scored as shared firsts.

**So the outcome channel is closed to us.** At p = 0.00076 and a per-event
placement swing bounded by 1.0, the flag's expected effect on `pFirst` is under
**0.08 percentage points**. The A/A floor on `pFirst` at 16 blocks is two orders
of magnitude wider. There is no batch this programme can afford in which a
placement column sees this flag, and **an arm scheduled to look for one is an
arm that never fires — which is not an experiment.** Do not write it.

### What IS measurable, and it is not the same number

The 0.076% bounds the **outcome** channel — how often a *game* ends that way.
It says nothing about the **decision** channel: how often an evaluated CANDIDATE
world has us and every rival eliminated together, which is what the clamp
actually reads. Those are different populations and the second is unmeasured.
The repair therefore ships with its own counter,
`MechanismReport.mutualWipe`:

- `reached` — evaluations whose clamp consulted the award (a mutual-wipe world),
- `awarded` / `refusedNotAhead` / `refusedStale` / `refusedNoRivals` /
  `refusedNoWeight` — the verdict split,
- `movedLo` / `movedHi` — clamp endpoints the award actually took off `DEAD`.

`null` on the whole block means the flag never reached the branch, which is a
different finding from zero — the ENGAGEMENT-TRISTATE rule, and the reason it
is null and not zeroed.

### The spec: a pilot, and a gate on its own engagement

**MW1-P (pilot, cheap, schedulable now).** Two arms, `mw-off` and
`mw-on` (`CENTAUR_MUTUAL_WIPE_AWARD=1`), on the two cells with a measured
non-zero rate (`headline-mix-king`, `null-snake6`) plus a **manufactured
high-mortality cell** — small board, dense roster, hazards on, food off, low
cap: everything dies quickly and everything dying *at once* stops being rare.
The pilot's deliverable is not a placement number and not a delta. It is **two
counts**:

1. `mutualWipe.reached` per game on the `mw-on` arm, and
2. `mutualWipe.awarded` and `movedLo`/`movedHi` per game.

**THE GATE.** If `reached` is negligible (say under 1 per game) the flag cannot
change a decision often enough to be measured live, at any block count, and MW1
**stops here**: the repair is carried on its correctness argument and its
deterministic tests, it is recorded as UNMEASURABLE-LIVE rather than as a null,
and no further box time is spent. That is a real outcome and the honest one —
`bin/ingest.js` will refuse an unengaged arm anyway, so a batch that skips the
pilot buys a refusal at full price.

**MW1-L (live, conditional).** Only if the pilot shows `reached` and `awarded`
materially above zero. Then the arm is scored **on mechanism, never on
placement**: `awarded` and `movedLo`/`movedHi` as engagement, deaths by cause
(does the bot start accepting fatal trades it used to refuse?), `finalMaterial`
and `pFirst` as descriptive rows carrying the standing underpowered caveat, and
the manufactured cell as the only one with any chance of a readable outcome
column. Do not pool the manufactured cell with the natural ones; it is a
different board and a different mortality regime, and pooling it would let a
constructed rate speak for a measured one.

### The conservative boundary the arm is testing, stated so a null is readable

The award refuses on four guards, and each refusal is a win declined rather than
a win manufactured:

1. **Strict lead only.** TacticToes pays a previous-turn TIE as a joint win —
   every tied team is a `Winner` and places first — and the flag refuses it
   anyway. One of the 7 corpus wipes is exactly this case, so the refusal is not
   hypothetical: it is 1 in 7 of the events, declined on purpose.
2. **Fully observed board only.** Any unit with `staleness > 0` refuses the
   whole award. A piece's stack can grow by more than one in a turn, so there is
   no sound pessimistic weight to substitute. Under the sim harness the board is
   fully observed every turn, so this refuses nothing in the regime the arm runs
   in — which is worth stating, because it means **the sweep does not test this
   guard at all** and only live centaur play would.
3. **Somebody to beat**, and 4. **positive own weight** — degenerate boards.

A null from this arm is therefore ambiguous in a specific, nameable way: it can
mean the rule change never fired, or it fired and the guards refused, or it fired
and the board did not care. The counters in §2 are what separate those three, and
an ingest without them cannot.

### Deliberately NOT in this spec

- **No ledger row.** `CENTAUR_MUTUAL_WIPE_AWARD` is not in
  `promotion-ledger.json` and this file does not put it there. A flag whose live
  channel is closed by arithmetic before it is run should be admitted to the
  ledger — if at all — as a correctness repair with a deterministic gate, and
  that is a schema question for the owner, not a candidate spec's decision.
- **No composition with W1.** The award reads the previous board's weights and
  nothing else, so it is orthogonal to the weight ladder by construction; run
  them in separate arms and keep it that way. A flag folded into a neighbour's
  arm can only ever be measured as a sum.
