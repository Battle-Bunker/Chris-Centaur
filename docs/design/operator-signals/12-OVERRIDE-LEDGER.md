# 12 — The override ledger: the surface measuring its own distortion

Doc 10 §4 named anchoring as the standing risk and promised the
counterweight: a track record of human overrides vs outcomes. This
document specifies that instrument under the program's three standing
extraction rules (conservation asserted inside the extraction; the
saturation rule; R-8 — never test residuals on a bounded statistic). It
is a second-scale instrument (doc 08): built from live-game records,
consumed as HELDs and calibration traces.

## 1. What counts as an override, and the join keys that already exist

An **intervention** is any operator act that changes what would have been
played or priced; every kind already carries an id this program's records
can join on:

| kind | id | counterfactual anchor (what the bot would have done) |
|---|---|---|
| A4 determination (pin, set-restriction, manual) | staging-wire event + EmitRecord | the incumbent at intervention time — the *forced* EmitRecord's predecessor in the journal (kernel.ts already journals both) |
| A2 support-demand | utteranceId in the emit basis | the pre-demand staged plan + floor (O0 contest entries bracket the demand's arrival) |
| belief-weight tilt | utteranceId cited by swung decisions | the untilted advised ranking (the ε-read at supplier='adversarial' — recomputable from the ledger, Law K) |
| ask answer | provokedBy join | the bot's own tie-break pick (retained but unshown under the unanchored default — doc 09 §3; retention makes the comparison possible *without* having anchored the human) |
| appetite/deadline changes | guidanceId premise coordinate | the prior-address decision stream |

The unanchored-ask design pays off here twice: because the bot's pick was
never shown, the human's answer is an independent draw, and the
(bot-pick, human-pick, outcome) triple is a clean paired comparison —
the only place in the whole program where human-vs-bot judgment is
sampled *unconfounded by the advice itself*.

## 2. The outcome labels, and the credit-assignment refusal

**Refused: end-of-game credit per intervention.** A game's outcome after
forty turns does not attribute to one turn-22 pin; pretending otherwise
is the clock-mixing class of artifact. Instead, three horizons, each with
its conservation check:

1. **Conformance horizon (≤1 tranche)**: did the intervention take effect
   as specified — already the conformance stream; no outcome claim.
2. **Realized-flow horizon (k turns, k small, declared)**: the per-unit
   flow delta actually realized vs the counterfactual anchor's *priced*
   expectation, extracted with the value lens's conservation-asserted
   pipeline (weight conserved up to named events *inside* the extraction,
   or the row is refused). This is a claim about weight, not wins.
3. **Game horizon**: interventions enter the game-level record only as
   counts and address coordinates (guidanceId in botDiff) — "games with
   live guidance vs without" is the guidance lens's paired-harness A/B
   (their 02 §7), a *population* claim measured their way, never a
   per-intervention attribution.

## 3. The statistics, under R-8

- Per-intervention "human beat bot" is bounded → **logit form**, per cell
  (board family × unit class), never pooled: the cyclicity finding says a
  pooled rating is not a sufficient statistic for exactly this
  population, and there is no reason human judgment would be less
  board-family-conditional than bot strength.
- **Saturation rule**: an operator who intervenes three times a game
  yields n≈3/game; every report carries n and the interval; MEAS-4's
  P(A beats B) with a stratified interval is the presentation template.
- **The mooted/ratified exclusions** (05 §3): mooted asks leave the
  denominator; `ratified` interventions (one-click accepted templates)
  are reported as their own stratum, never merged with `authored` — else
  the surface can inflate the human's record by pre-filling good answers,
  which is the laundering rider read as a measurement threat.

## 4. What the instrument feeds, and who sees it

- **Owner/second scale first.** The scoreboard ships as doc-08 HELDs
  (per-operator, per-channel, per-cell) with premise; the *operator-
  visible* form (the empathy scoreboard for belief-weights, 05 §5, plus
  a determinations track record) is enabled per policy only after the
  owner has seen a first population — a visible scoreboard changes the
  behaviour it measures (deference or bravado), and which way it distorts
  is itself unknown until measured. The instrument's own distortion is
  measured by the same A/B (scoreboard-visible vs not) if the owner ever
  wants it settled.
- **The ADVICE selection eventually reads it** — an operator whose
  corridor reads calibrate well should see corridor asks earlier — but
  that is a *member* (a selection value function variant) behind Law
  F1/F2 fit provenance, not a default; and it must never gate the
  humans-always-win paths (a poorly-calibrated operator's pin still
  plays; calibration tunes *invitations*, never *authority*).

## 5. Ship shape and the honest first result

Reads only: O0 ledgers (contest entries, matrix), EmitRecord journals,
the guidance table's utterance ids, the conformance stream, and the value
lens's extraction tools pointed at the realized-flow horizon. No new
in-decision instrumentation. The expected first result is **n = 0** — no
operator event has ever fired in a harness game (time lens §5's honest
marker) and no human game exists in any corpus (joints 07 §8). That is
not a weakness of the instrument; it is the joints lens's "expect this"
bullet operationalized: the telemetry must exist *before* the first
Centaur games or those games' most valuable product — the first
unconfounded human-vs-bot sample — is discarded on arrival, which is
precisely the mistake O0 exists to stop making for the bot's own
signals.
