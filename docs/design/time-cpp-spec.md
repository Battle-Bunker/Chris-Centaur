# CPP compilation spec — executable against the archive as it exists

Makes `time-economy-goods.md` §1 buildable: exact inputs, queries, scoring,
and output shape for compiling the first conditional performance profiles
from the replay archive, no new games. Grounded in the replay format
(`harness/lib/replay.ts`: header + per-turn rows carrying the FULL start
board, resolver-seen tiers, staged moves per seat, events, world step —
"NOTHING IS EVER DELETED").

## 1. Inputs the archive already supplies

Per turn row: `board` (full api Board at turn start), `tiers` (frozen
resolver inputs — cannot be recomputed from the board; the row carries
them for exactly this reason), `staged` (per unit: move, seat, bot,
spoken), header `config` + `seats` (self-describing; bundle/lineage from
the sweep records). That is sufficient to RE-DECIDE any recorded seat's
turn from scratch at any budget: construct the decision input exactly as
`match.ts` does (board, turn, teamID, deadline, seed) and call the
bundle's `bot.decide`.

## 2. The ladder

For a sampled (game, turn, seat): re-decide at rungs
`q ∈ {q0, 2q0, 4q0, …, Q}` (geometric, ratio 2 — the theorem default).

- **v0 (runnable today):** rungs in milliseconds on an idle box, with the
  box-noise caveat stamped into provenance (batch 2 measured wall floors
  widening ×17.76 under load — v0 profiles are provisional by
  construction and say so).
- **v1 (after increment 2's handle swap):** rungs in quanta via the
  counting budget — deterministic, box-independent; prefix determinism
  makes the ladder cheap (a larger rung's decision sequence EXTENDS the
  smaller's, so one top-rung run with checkpoints yields every rung).

## 2½. The second quality axis: maxGap (search-theory doc 07, adopted)

`maxGap` — the ratchet's proved hi−floor gap — is a RECOGNIZABLE quality
measure in Zilberstein's checklist sense: most anytime algorithms can only
estimate their current quality; our bounds layer BOUNDS it, and the
ratchet already enforces its monotonicity. It is also the hand-built
proxy for the shrinking option set (what Γ-maximin refuses to produce).
So the CPP carries TWO quality axes:

- **agreement** (decision changes — §3): did more work change what we
  stage;
- **maxGap-vs-quanta** (proved discrimination): how fast the proved gap
  closes.

They can disagree informatively, and the disagreement is a diagnostic:
plans changing while the gap stays flat = WANDERING (belief-decided
churn); gap shrinking while the staged plan is fixed = CONFIRMATION work
(buying certainty, not change). Report both per stratum. Cost: the gap
curve needs no re-decisions at all — ONE EMITTED FIELD (per-emission
(atQuanta, maxGap) pairs in the replay telemetry, bounded by the
emission count) yields quality-vs-time curves per board class from every
future live game; the existing corpus already carries the endpoint
(`telemetry.chosen.lo/hi` at the played budget). The field joins
increment 2's ledger schema.

## 2¾. The third axis, and the key (librarian C48/M47/M48, adopted)

- **Margin at the deciding rung**, `Pr(margin | quanta, premise)` — the
  discriminator between "saturated because extracted" and "saturated
  because the evaluator cannot separate the plans" (Thompson's
  constant-returns lesson: weak-evaluator masking masquerades as
  diminishing returns). Wide margin + flat agreement ⇒ fund-ponder
  stands; near-zero margin + flat agreement ⇒ the remedy is the
  evaluator, and the profile's saturation is expected to LIFT when it
  improves. The column is shared with three other consumers (contrastive
  foils, P(flip) pricing, the spread instrument). v0.1: capture
  `telemetry.chosen` and the mechanism advisory rows per rung — recorded
  by the harness, discarded by the v0 script. SCOPING FACT (checked
  against b5's foldMechanism): the true margin needs the RUNNER-UP's
  value at the deciding rung, which no current telemetry carries — it is
  an engine-side emitted field (one number at staging time, the same
  surface the contrastive-foil consumer needs), so it lands with
  increment 2's emitted fields, not a miner-only v0.1. Interim proxy
  available today: the adjudication-rung MIX per rung
  (floorDecided/estDecided/tieKeyDecided counts) — coarse, direction
  only, stated as such.
- **Every CPP is keyed on evalVersion** (M48): saturation is a property
  of the evaluator; profile reuse across evaluators is a silent premise
  crossing, and the coordinate already exists in the declaration record.
  ASSERTED, not documented (rollup fold §8, the metamorphic
  hypothesis-assertion pattern): the profile READER refuses on
  `consumer.evalVersion !== profile.evalVersion` — a stale curve can
  never silently price a re-dialed bot, and the first evaluator change
  trips the assertion loudly instead of degrading every consumer's
  numbers quietly.

## 3. Quality, scored two ways (both reported, neither alone)

- **Agreement** (ordinal, model-free): staged(q) == staged(Q). The CPP's
  headline curve is Pr(agreement | q, strata).
- **Priced regret** (cardinal, model-based): value the rung's staged
  joint move under the TOP rung's bank (one extra `price()` per rung on
  the top rung's session) — `est(Q, staged(Q)) − est(Q, staged(q))` in
  sharePar units. Declares its weight/evalVersion tags like any estimate;
  its bias is the evaluator's own, which is the honest limit of offline
  compilation and is stated on the member.

## 4. Strata = premise coordinates (the fibration, cashed)

Minimum viable strata, all derivable from the row: roster mix (snake-only
/ mixed / piece-heavy — the throughput-collapse axis), commandable-unit
count, phase (turn / turnCap), contact structure (any enemy within k),
potion presence. Report n per cell; refuse cells below a floor rather
than interpolating silently (the miner refuse-don't-default law).

## 5. Output: members with provenance

    tools/simworker/bin/cpp-compile.js  →  cpp/<strata-key>.json
    { profile: [{q, prAgree, regretMean, regretP90, n}],
      provenance: { corpus: [sweepIds], lineage: bundleSHA, rungs, clock:
                    'ms-v0'|'quanta-v1', fitDate, boxNote } }

Consumers (grant targets, market E[improvement | flip], settled-early
expected-gain, the equal-expected-quality comparison) read the member by
id; the id joins the CONFIG coordinate, so no two verdicts under
different profiles compare silently.

## 6. First questions the v0 profile answers (each currently answered by feel)

1. Where does Pr(agreement) saturate per stratum — i.e. what does the
   9,850 ms production budget actually buy over 1,000 ms on each board
   class? (The owner has never had this curve.)
2. Is per-tranche improvement high- or low-variance (M4)? Low ⇒ fewer
   monitor points and larger contracts are correct.
3. The piece-board starvation curve: does the queen cell's agreement
   still climb at the top rung (starved — funds the ponder case) or
   plateau early (the 16× collapse is enumeration overhead, funds the
   structural-pre-build case instead)? This single readout arbitrates
   which ponder-ladder policy the worldline increment ships first.
