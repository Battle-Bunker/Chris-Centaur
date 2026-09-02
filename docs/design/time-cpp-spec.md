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
