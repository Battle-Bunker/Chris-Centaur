# Supplier log-loss harness v0 — first measurements

The ε law, measured. Harness: `tools/supplier-logloss/harness.py` (spec 02-doc
§4b; v0 approximations declared in its header, every one with a counter). Full
tables: `tools/supplier-logloss/results-v0-full.md`. Zero games; ruling-13
instrument work on logged data.

**Corpus** (the fit's population premise, stamped per ruling 49): 1,412 games /
1,155,029 unit-decisions — the i3 sweep archives (23×23 snakes/mix/sliders,
potions OFF, bots reflex / i3-material / lobster-territory) plus the
potion-intel run archives (potion-snake6 + hazard cells, potions ON, lobster
lineages). All numbers are facts about THESE policies; no human play, no
adversarial opponents.

**Suppliers** (all with the same λ=0.25 uniform floor, so log-losses compare on
equal smoothing): `uniform` over the constructed support (legal minus
rules-certain-fatal); `default` (engine default action: snake straight, piece
stay); `food` (greedy toward nearest food); `cover` (ruling-23
cover-proportional); `advpoint` (point mass on the cover argmax — the
"always guesses right" caricature, priced).

## Headline table (ALL, n=1,155,029; contact = decision-weighted proxy, n=182,620)

| supplier | log-loss ALL | vs uniform | log-loss CONTACT | vs uniform | ε̂ ALL | ε̂ CONTACT |
|---|---|---|---|---|---|---|
| uniform | 1.144 | — | 1.132 | — | 0.088 | 0.145 |
| default | 1.467 | +0.324 | 1.546 | +0.415 | 0.568 | 0.676 |
| food | 1.826 | +0.682 | 1.772 | +0.641 | 0.433 | 0.421 |
| cover | 1.244 | +0.101 | 1.544 | +0.413 | 0.090 | 0.457 |
| advpoint | 1.267 | +0.123 | 1.604 | +0.473 | 0.109 | 0.469 |

(ε̂ = coarse ε_min, a lower bound on the exact contamination; CIs in the full
tables are a few points wide at these n.)

## The five findings

**1. The support IS the model (the architecture's own vindication).** On the
modal stratum — snakes at branching ≤3, 90% of all decisions — uniform over
the constructed support scores 0.993 nats and its own ε̂ is 3–5%: observed
play is representable as "uniform over legal-minus-fatal plus ≤5%
contamination". Nearly all predictive power lives in CONSTRUCTING S, not in
any weight over it. This is the strongest possible support for the
support-first factorization: the floor's own admissible set is already the
best single predictor of this population, and the bar any weight supplier
must clear ("beats uniform on log-loss", 02-doc §4b) is high because S
already cleared it.

**2. Default-action owns the piece strata — the one admissible supplier.**
`default` beats uniform by −0.64 (king), −1.08 (knight), −1.48 (rook), −1.74
(bishop, quiet) and −0.77 on branching ≥9: pieces in this population mostly
HOLD, and the engine's default action is the only supplier that knows it.
The QUEEN is the exception (+0.26 WORSE than uniform: queens actually move —
uniform's 4.11 nats ≈ 61 live options). Two readings, both true: the engine
default prior is the first est-rung-admissible weight for non-queen piece
coordinates; and "pieces mostly hold" is a POPULATION fact about our bot
lineages that corroborates the piece-cell verdicts (mis-seated profiles,
under-used pieces) from the value line.

**3. Cover is conservative, now with a number on it (the ruling-23
measurement).** At contact — the decisions where prediction could matter —
cover costs +0.41 nats vs uniform and needs ε̂ ≈ 0.46; the adversarial
caricature costs +0.47 and needs ε̂ ≈ 0.47. This population attacks FAR less
than cover-proportional, and far, far less than always-best-response. Read
correctly for the two roles: as an est-rung PREDICTOR, cover fails
admissibility on every measured stratum (it never beats uniform); as the
dodge discount's PRICING device it sits exactly where the owner's rulings
place it — the measured pessimism ordering is `adversarial > cover >
empirical`, so cover-weighted fear is a strict, quantified reduction from
worst-case fear while remaining conservative against this population by
~0.4 nats at contact. Ruling 22's "assuming the enemy always guesses right
makes us unrealistically afraid" now has a magnitude.

**4. ε̂ is NOT stable across strata — my entropy-band conjecture is refuted
as posed.** ε̂(cover) runs 0.03 (b≤3) → 0.43 (b4–8) → 0.58 (b≥9) and 0.12
(quiet) → 0.46 (contact); every supplier shows the same swing. There is no
single ε for a supplier — only ε̂(supplier, stratum), which the ε law
anticipated in form ("fitted per stratum") but not in magnitude: a pooled ε
would be silently wrong by an order of magnitude in both directions
depending on the board. The premise-coordinate discipline is load-bearing,
not decorative. (Honesty note: the coarse ε_min is a lower bound and the
category coarsening itself varies by stratum; the SWING is real but its
exact sizes are floor values.)

**5. Instrument health.** Support-miss: snakes 1.50% (≈ the eating rate —
the tail-vacation assumption fails exactly when the owner eats; declared),
pieces 0–1.9% after the capture-destination fix (v0's first run caught that
sliders' capture moves were excluded — 13.4%/12.7% misses on queen/rook —
fixed in-session; the counter did its job). Cover falls back to uniform on
87% of decisions (no target in range — it is a contact-gated model by
construction). λ-floor comparability holds across all rows.

## Verdicts the numbers force

- **est-rung admissibility today**: `default` on non-queen piece coordinates
  only. Nothing beats uniform on snake coordinates; cover/advpoint are
  predictors nowhere. The est rung's weight, if any ships first, is the
  engine default prior on pieces — which costs nothing to compute and is
  already the engine's own vocabulary.
- **The dodge discount keeps cover** — its job is conservative pricing, not
  prediction, and the measurement brackets it on the correct side
  (conservative by ~0.4 nats at contact vs this population).
- **The ε law survives with its premise discipline made mandatory**: ε̂ is a
  table over (supplier, stratum) with CIs, never a scalar. The
  PremisedMember refusal semantics (08-doc §7) are not optional hygiene —
  they are the difference between a measured constant and a wrong one.
- **Population caveat on everything**: these are our own lineups' habits.
  The first human-play or adversarial-bot corpus re-runs this harness
  unchanged and the deltas become the adaptation signal (still parked under
  ruling 13).

## v1 items (queued, cheap)

Per-bot-family strata (make the population coordinate visible in the table);
eating-aware tail vacation (kills the 1.5% snake miss); exact per-decision
ε_min on binned supports (replace the coarse lower bound); B7-falsifier
hookup (ε × plyCap grid once any τ/ε > 0 candidate exists); DeepObservation
laundering check (the search lens's B-2) once the value-table increment
lands.
