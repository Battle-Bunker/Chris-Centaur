0. MERGE claude/kit-depth-miner-fix into sim/worker-kit (+potion-intel-kit) BEFORE any further mining (refuses-not-defaults miner + new columns).
   DONE for potion-intel-kit (2026-09-01 ~03:56): fast-forward 639416b
   into $SP/ppkit (tmp/potionplay-kit). depth-ran.js, focus-deaths.js,
   potion-defense-mech.js, within-game.js now present and safe to use.
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
   THE REPLAY READ (item 8, done, ZERO new games) CHANGES THE STORY.
   `replaymech.js` over k1's 288 replays, all three bots in every game:
   **`potionOrdering` makes the bot collect 22% more potions on the hazard
   cell and 45% more on the plain one**, for no search cost. THE
   COLLECTING CAPABILITY THE OWNER ASKED FOR EXISTS AND IS DEMONSTRATED
   IN PLAY — the first potion configuration in this programme shown to
   change play in the intended direction with a number attached.
   IT STILL DOES NOT SMASH, AND NOW WE KNOW WHY: on the hazard-free cell
   it collects 45% more potions and scores +0.021 [-0.143, 0.213]. **The
   prize is too small.** At effectTurns 3 an invulnerability potion is
   worth less than the tempo spent reaching it. That is a finding about
   the GAME, not about our bot.
   And the full causal chain of the hazard harm is measured: potions
   +22% -> hazard occupancy +5% -> head entries into hazard +4% ->
   deaths/game +13% (2.75 -> 3.10) -> sharePar -0.145. Control holds: on
   the hazard-free cell the same bot dies slightly LESS.
   The expensive half does nothing: `potionBoth` collects only 0.05-0.15
   more potions/game than `potionOrder`, and scores +0.001 against it.
   **SO THE TOP OF THIS ITEM IS NOW A BOARD-SETTINGS SWEEP, NOT A BOT
   CHANGE: at what potion settings does collecting them pay?** Vary
   `effectTurns` (3 -> 8 -> 20) and potion scarcity, with the
   already-working `potionOrdering` flag on, and find where the curve
   crosses zero. If no reachable setting makes it pay, say so to the
   owner plainly and leave the flag selectable, default OFF on hazard
   boards. This is queued as cycle k5.
   The proved-bounds architecture route is DEPRIORITIZED by this: it
   would make the bot value potions more precisely, and the measurement
   says the problem is that potions are not worth much.

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

3. Piece-cell floor calibration — **DONE, cycle k3, 288 games. VERDICT:
   the piece cell's floor is SOUND and the programme-wide claim "piece
   cells have no usable floor" should be WITHDRAWN.**
   `potion-snake5-knight` at 48 blocks: A/A floor -0.176 [-0.364, 0.018]
   — CONTAINS ZERO — and it falls as 1/sqrt(blocks) to within 9% at every
   count from 12 blocks up (ratios 1.09, 1.02, 1.00, 1.03, 0.97, 1.00,
   1.00). It is the best-behaved cell measured in this programme, better
   than either snake cell.
   What the three earlier "broken floor" observations share is not a
   piece board, it is 8 blocks — a count at which a bootstrap interval
   cannot be trusted, and at which a WIDE cell will exclude zero often
   enough to look like a finding. c1's -0.490 [-0.688, -0.270] did not
   survive the count.
   Second-order contributor confirmed: `armservice.js` on k3 shows the
   first arm buying more search in 3 of 3 bot pairs, mean +3.89% and
   +9.5% on the hungriest bot — which is why the mean ΔG sits at -0.176
   rather than 0 and why the floor is wider than pure sampling predicts.
   THIS UNBLOCKS piece-cell readings across the programme — batch 2's
   `hazard-mix-king` and `headline-mix-king` rows, the overnight
   roster-ladder table, and the knight rung of item 1's ladder — provided
   they are run at enough blocks and read against the reading's own
   interval. The cell is still expensive: ±0.10 needs ~190 blocks.
   Details: `$SP/continuous/item3-piece-floor/results.md`.

4. Evaluator-selection ladder (overnight R1) at owner shape, chunked.
   STARTED 2026-09-01. Cell 1/6 (snake6, null roster, 8 blocks) LANDED:
   territory-material +1.620 [1.467,1.800], territory-reflex +1.691
   [1.488,1.916], both clear their own floor easily — matches the
   overnight preview's direction on the all-snake control. Confirmed
   throughput at owner shape: 16 games/hour/arm, ~1.5hr per 8-block cell,
   ~6hr for R1's full 32. 5 piece cells remain (the actual open question
   — overnight found the advantage shrinking/reversing there). Open
   scope decision flagged for the owner: 8-block first pass on all five
   (~7.5hr) vs full 32 on the highest-value rung vs pause. STATE.md §11.

5. gainOrdering rerun under potions (R6).

6. Focus-narrowing search prototypes vs uniform-depth (as the builder
   lands them): scenario-suite win rates + generic-cell non-regression.
   Still unbuilt — ruling 41 names it as part of the highest-priority
   branch, so this rises to the top the moment a prototype exists.

7. NEW, AND RUNNING NOW as cycle k4 — THE HAZARD DOSE-RESPONSE. k1+k2
   found the free potion-ordering slot harming play on the
   interior-hazard cell (-0.145 [-0.258, -0.035], replicated across two
   independent runs) and doing nothing on two hazard-FREE cells (+0.021
   snake, +0.069 knight). The only cell with hazards is the only cell
   with harm, which is what the mechanism "sorting a pickup as a gain
   walks units across hazard cells to reach potions" predicts. Two cells
   is not a dose-response curve, so k4 runs the SAME cell at damageRatio
   0.05 / 0.15 / 0.30 with everything else fixed. Monotone harm rising
   with damage confirms the mechanism; a flat profile kills it. 24 blocks
   x 3 rotations x 3 cells = 216 games per arm, ~68 min.
   (The kit REFUSES damageRatio 0 with layout 'cross' — "hazard cells
   that do nothing" — so the low rung is 0.05, not 0. Correct guard.)
   Either way it is cheap, and it decides whether anyone should touch the
   ordering code.

8. REPLAY INSPECTION — **DONE, zero games.** `$SP/continuous/replaymech.js`
   over k1's 288 replays. It produced the strongest result of the run:
   the collecting capability is real (+22-45% potions), the prize is
   small (45% more potions buys +0.021 sharePar), and the hazard harm's
   causal chain is fully measured. Folded into item 1 above. The tool
   generalises — point it at any batch to get per-bot potions collected,
   hazard occupancy, head entries into hazard, health per unit and deaths
   per game, all paired within game.

9. NEW, TOP OF THE POTION WORK — THE POTION-VALUE SWEEP (cycle k5).
   With `potionOrdering` ON (it demonstrably collects), sweep what a
   potion is WORTH and find where collecting starts to pay:
   `effectTurns` 3 (current) / 8 / 20, on the hazard-free cell so the
   hazard interaction does not confound it. Contenders `potionOrder` vs
   `plain` in one game. If the curve crosses zero at a reachable setting,
   the owner has his answer and the flag ships for those boards. If it
   never crosses, the honest report is that invulnerability potions are
   not worth chasing in this game at any setting the harness offers —
   which is a finding about the GAME and should stop the potion effort
   rather than deepen it.
   Cheap: 24 blocks x 3 rotations x 3 cells = 216 games/arm, ~68 min.
   **RAN — CLOSED (2026-09-01 ~03:56).** 432 games, 0 failed. It never
   crosses: G = +0.054/+0.049/+0.047 at effectTurns 3/8/20, every 95% CI
   contains zero, no rise with effectTurns despite potionOrder collecting
   30-51% more potions than plain at every setting (replaymech.js
   confirms the capability is still working; the prize just never pays).
   **Standing verdict: invulnerability potions are not worth chasing in
   this game at any effectTurns the harness offers. potionOrdering stays
   selectable, default OFF on hazard boards** (per item 7's replicated
   -0.145 harm there). Full table: $SP/continuous/STATE.md §7.

10. Cycle k4 RERUN as k4b (2026-09-01 ~03:57) — same hazard dose-response
    as item 7, on bundle b5 (rebuilt from claude/cluster-lookahead@79b5f5e,
    the first-plan toll fix) instead of the pre-fix b4. k4 was aborted at
    90/216 games/arm on the prior pause; k4b reruns from a cleared batch
    dir on the same deterministic seeds.
    **LANDED (survived 2 container-recycle deaths + --resume): 212/216.
    DOES NOT REPLICATE item 7's harm finding.** G = +0.032/+0.015/+0.178
    at damage 0.05/0.15/0.30 (24 blocks each); hazard occupancy and head-
    entries into hazard are now statistically identical between
    potionOrder and plain at every dose (were elevated for potionOrder on
    b4). **The old -0.145 harm number was measured on b4 and is superseded
    by the toll fix — do not quote it without that caveat.** Standing
    recommendation changes: no evidence of harm on b5; weak evidence of a
    small benefit at damage 0.30 (CI [0.021, 0.338], barely excludes
    zero). Not yet a full replication of the original k1/k2 cell — flag
    for the owner. Full table: STATE.md §9.

## From architecture-design push (2026-09-01, owner-directed 4-lens exploration)
- [ ] Double-pessimism falsifier (composition lens, cycle 2): hold epsilon fixed,
      vary plyCap; if depthEffectRate falls as plies rise, deep findings are
      being charged for width twice (once in blended value, once in sigmaOfPly
      precision). Cheap, decisive, runs in this sandbox.
- [ ] Ordering-law race (composition I4): additive member vs shipped
      lexicographic precedence at the ordering joint; shipped precedence must
      reproduce gainOrderKey exactly first (falsifier for the migration).
- [ ] Seat lobster-territory-x (command:2) on snake5-queen + one more piece
      cell — settles the command:0 confound (value lens).
- [ ] k5 potion-value rerun on snake5-queen roster: potion = P(win)
      multiplier on transfer flow, worth ~0 without a fat enemy account —
      predicts the k5 null does NOT replicate there. One cell before
      "potions never pay" hardens into doctrine.
- [ ] Admitted-set feature-spread instrument: measure each feature's spread
      across the 8 ADMITTED candidates (not all legal moves); near-zero
      spread makes its weight inert at any value — candidate mechanism for
      "weights do nothing".
- [ ] restrictedGap instrument (search-theory lens): per-decision V_mixed −
      V_pure on the bank's own restricted matrix (tiny LP / regret-matching+,
      microseconds). Zero games; retires or prices the mixed-strategy
      direction on evidence. Standing mechanism-report column candidate.
- [ ] accept() comparator-cycle instrument: count accept-events per planKey
      within one improve() call; max>1 = the two-comparator cycle is live
      (structurally reachable whenever the scout has spoken). Repair law on
      record (search-theory doc 00 §3).
- [ ] Supplier log-loss harness (belief lens, 02 §4b): score every
      weight-supplier's −log w(actual move) against Turn.moves on the replay
      archive; 'adversarial' as reference row; gap to 'cover' = measured
      value of ruling 23 before any bot changes. Zero games.
- [ ] Win-only terminal re-score (red team round 2): re-score existing corpus
      under win-only scoring; predict R² collapse + variance-seeking-when-
      behind residual. Zero games; tests "fold survives measure changes,
      breaks under terminal-functional changes" in one run.
- [ ] proposedBy tag on accepted trials (search lens): eight proposal
      operators, nothing records which proposed the accepted trial; one tag
      makes the whole layer measured; prerequisite for adaptive schedules;
      likely retires two operators. Cheapest instrument on the books.
- [ ] Adjudication split contested-vs-quiet: floorDecided/estDecided/
      ceilingDecided/tieKeyDecided by cell class — tests "saturated maximin
      floor carries no ordering info on contested cells" for free.
- [ ] B-3' odometer-prefix fix + falsifier (search lens doc 04): scout
      scoreOptions enumerates a contiguous odometer prefix, pinning all but
      the last unit at the generator's first option — degenerate exactly on
      slider boards; ~15-line round-robin single-unit fix is CHEAPER for
      ≤3 members. Falsifier: fixed slider-board scenario set, compare
      argmaxMoved/estSpread per ply, both versions.
- [ ] B-4 free alpha-beta cut: worstHi<=bestLo row cut in scoreOptions —
      sound, changes no published value, converts directly to more plies
      at the same tithe. Per-row theirCoverage reporting required.
