<!-- SNAPSHOT: source scratchpad/experiment-queue.md — synced 2026-09-01T01:13:23Z by the branch-topology housekeeping task.
     This is a point-in-time copy, not the live document. The working copy is the coordinator's
     scratchpad; this branch exists so the owner can reach it if that box is unreachable. -->

# DYNAMIC EXPERIMENT QUEUE (ruling 40)
# This sandbox runs continuously from the top; PC batches = 9h packages
# cut from here on owner request. Keep prioritized; runner updates.
#
# Last reprioritized: 2026-08-31 by the continuous runner, after sandbox
# cycle c1 of the potion ladder. Running state: $SP/continuous/STATE.md.
# Per-item blocks and numbers: $SP/continuous/<item>/results.md.
# Current PC package: $SP/continuous/pc-batch-next.md (current as of this
# revision).

1. Potion-intel acceptance games — the SMASH criterion, continuous.
   STATUS: RUNNING in the sandbox. `feature/potion-intel` is still not on
   origin and carries no commits; the builder is iterating on the local
   branch `tmp/potionplay` (`$SP/pp`, tip `7f89a74`) and the acceptance
   games run against bundles built from its commits. Re-check
   `git ls-remote origin | grep -i potion` every cycle.
   BLOCKS: 8 per cell in the c1 field, 8 per cell in the c2 field, 24 in
   flight in the c3/k1 field. (Blocks accumulate WITHIN a field only —
   sharePar is a share, so a within-game contrast moves when the third
   seat changes: the same potionAware−plain read -0.476 in c1's field and
   +0.007 in c2's.)
   READ SO FAR — 288 live games over two cycles, 15 cell readings, and
   THE DOCTRINE HAS NOT WON ONE OF THEM. Every point estimate is at or
   below `plain`; not one clears its own A/A floor in either direction.
   The weight ladder (c2) does not rise: `potionBold` sits at or below
   `potionAware` on all three cells.
   THE MECHANISM SAYS WHY, AND IT IS NOT THE WEIGHT. The advisory moves
   the estimate by **0.55-1.04% of the width of the proved interval it is
   moving inside** (2-3% at "bold"), with 99-100% of the ask applied — so
   the clamp is not the limiter, the ask is simply negligible against its
   own interval. A term that small can only decide a near-exact tie. And
   it is not free: the lineup costs 14-16% of plans per decision in a
   three-search-bot field and 28-44% in c1's. A large measured price for
   an inert adjustment is the entire explanation for G <= 0.
   SO A LOUDER WEIGHT IS A DEAD END and the ladder moved to the CHANNEL:
   plain vs the ordering slot alone (`candidates.potionOrdering` — a
   pickup sorts as a gain, ZERO evaluator cost) vs both halves.
   CYCLE k1 RAN IT — 288 games, 24 blocks, two cells. The mechanism rows
   confirm the design held: `potionOrder` ran ZERO advisory evaluations
   and evaluated 1.7-3.7% MORE plans per decision than `plain`, so the
   free channel really is free; `potionBoth` paid 15-16%.
   THE FREE CHANNEL DOES NOT EARN — IT HARMS, AND IT REPLICATED. Cycle
   k2 re-ran k1 exactly, on disjoint seeds. On the interior-hazard cell
   `potionOrder − plain` came back **-0.146 (k1) and -0.143 (k2)**,
   pooling over 48 blocks to **-0.145 [-0.258, -0.035]** — an interval
   that excludes zero, from two independent runs agreeing to three
   decimal places. On the no-hazard cell it is worth nothing (+0.021).
   And `potionBoth − potionOrder` pools to +0.001: the expensive advisory
   adds NOTHING on top of the free ordering; the ordering half does all
   the work, and on hazard boards the work it does is harmful.
   VERDICT ON THE SMASH QUESTION: NO. Four configurations — quiet
   advisory, bold advisory, free ordering, ordering plus advisory — have
   now been played in 1,152 live games and none beats the shipped bot.
   NEXT, cheapest first: (a) open k1/k2's replays and check the obvious
   mechanism — that sorting a pickup as a gain walks units into hazard
   cells to reach potions; (b) the one untried architectural route, which
   is letting potion value into the PROVED BOUNDS rather than arriving as
   a clamped advisory nudge inside them. (b) is a builder change, not a
   configuration, and (a) should inform it.

   READING RULE CORRECTED — THIS APPLIES TO EVERY ITEM. "An effect must
   exceed the A/A floor" compares two different quantities. The floor is
   the spread of the DIFFERENCE of the two arms; the reading is their
   AVERAGE. For independent arms the difference has variance 2v and the
   average v/2, so the floor is ~2x the reading's own half-width AT ANY
   SAMPLE SIZE — measured 2.63 and 1.96 against a theoretical 2.00. The
   rule therefore demands about twice the effect the data require, and it
   suppressed a real, replicated result. Use the A/A null for BIAS
   (identical arms must average to zero — they do); use the reading's own
   interval for effect size; and require REPLICATION ACROSS CYCLES, which
   is the check that actually caught this result.

   SIZING CORRECTION THAT AFFECTS EVERY ITEM IN THIS QUEUE: block targets
   were being computed from an unverified 1/sqrt(n) assumption.
   `floorscale.js` tested it on k1's own nested block prefixes.
   `potion-hazard-snake6` obeys it (ratios 1.21/1.11/0.97/1.00);
   `potion-snake6` does NOT — its floor fell only 0.634 -> 0.518 from 12
   to 24 blocks where 1/sqrt(n) predicts 0.448, the signature of a heavy
   tail. A ±0.19 floor needs ~51 blocks on the hazard cell and ~178 on
   the plain snake cell, against the 32 previously targeted. **Size every
   cell from its own measured scaling; never quote one block target for a
   batch.** Run `floorscale.js` on any cell before promising power for it.

2. P11 decidable read: baseline vs search-arch. RAISED IN VALUE — batch 2
   put it one batch away from decidable, and the 16-block reading already
   leans AGAINST the branch (sharePar -0.63 [-1.26, -0.008] on
   hazard-mix-king, fully engaged mechanism rows). 57 fresh blocks per
   cell on the owner's box pools to the 73 the power calculation needs,
   which is ~3.1 h — so this is now a PC slot (packaged as Slot A), not a
   sandbox grind. The sandbox accumulates a SEPARATE small-board read
   only when item 1 is blocked on the builder; the two do not pool.
   BLOCKS: 16/cell at owner shape (batch 2); 0 at sandbox scale.

3. Piece-cell floor calibration (was item 4) — PROMOTED above the
   evaluator ladder. Two independent runs now show a piece-bearing cell
   whose A/A floor EXCLUDES ZERO between identical arms: batch 2's
   mix-king widened to ±0.53, and sandbox c1's knight cell came back
   -0.490 [-0.689, -0.267]. Until this is characterized, every
   piece-cell reading in the programme is uninterpretable — including
   the knight rung of item 1's own ladder. Packaged as the PC fallback
   Slot A2 (floors at 16/32/64 blocks, to test whether the half-width
   even falls as 1/sqrt(n); if it does not, the cell is heavy-tailed and
   needs a different estimator).

4. Evaluator-selection ladder (overnight R1) at owner shape, chunked.

5. gainOrdering rerun under potions (R6).

6. Focus-narrowing search prototypes vs uniform-depth (as the builder
   lands them): scenario-suite win rates + generic-cell non-regression.
   Still unbuilt — ruling 41 names it as part of the highest-priority
   branch, so this rises to the top the moment a prototype exists.
