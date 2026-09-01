# CONTINUOUS RUNNER — HANDOFF (one page)

`SP=/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad`

Resume cold from `$SP/continuous/STATE.md` — it is written to be
sufficient on its own. This page is the summary.

## What was run

Five cycles, **1,152 live games plus 288 replays read**, all on the
potion work (queue item 1) and the piece-cell floor (item 3). Batches
under `$SP/continuous/k1..k5`; earlier `$SP/ppruns/c1,c2` were inherited
in flight and are folded in. Numbers, tables and caveats live in
`$SP/continuous/item1-potion-ladder/results.md` and
`$SP/continuous/item3-piece-floor/results.md`.

## The three things worth telling the owner

1. **The potion-collecting capability EXISTS and is demonstrated in
   play.** `candidates.potionOrdering` — one flag, a potion pickup sorts
   as a gain — makes the bot collect **22% more potions on a hazard board
   and 45% more on a plain one** than the byte-identical bot without it,
   in the same games, at zero search cost. This is the first potion
   configuration in the programme shown to change play in the intended
   direction with a number attached.
2. **It does not SMASH, and the reason is the game, not the bot.** On a
   hazard-free board it collects 45% more potions and scores
   **+0.021 [-0.143, 0.213]** — nothing. At `effectTurns: 3` an
   invulnerability potion is worth less than the tempo spent reaching it.
   On hazard boards the chase is a net **loss** of -0.145 [-0.258,
   -0.035] (replicated at -0.146 and -0.143 in two independent runs)
   through a fully measured chain: potions +22% → hazard occupancy +5% →
   head entries into hazard +4% → deaths per game +13% → sharePar -0.145.
   The expensive advisory slate contributes nothing to any of it (+0.001
   over the free flag; it moves the estimate by under 1% of the width of
   the interval it moves inside while costing 14-44% of plans/decision).
3. **Two measurement rules the programme was using were wrong.**
   - "An effect must exceed the A/A floor" compares the spread of the
     DIFFERENCE of two arms against a reading that is their AVERAGE, so
     the floor is ~2x the reading's own half-width **at any sample size**
     (measured 2.63 and 1.96 vs a theoretical 2.00). It suppressed the
     replicated result above for a full cycle. Use the A/A null for BIAS,
     the reading's own interval for effect size, replication for
     confidence.
   - **"Piece cells have no usable floor" is withdrawn.** At 48 blocks the
     knight cell's A/A floor is -0.176 [-0.364, 0.018] — contains zero —
     and scales as 1/sqrt(n) to within 9% from 12 blocks up. The three
     earlier sightings share a block count of 8, not a piece board. This
     unblocks batch 2's mix-king rows and the roster-ladder table.
   - Related: block targets assumed 1/sqrt(n) scaling that does not always
     hold, and a floor from one 24-block run varies by ~2x between cycles
     with the box's load. Size each cell from its own `floorscale.js`
     curve; never quote one block target for a batch.

## State right now

- **Cycle k4 RUNNING** (`$SP/continuous/k4.log`, 216 games/arm, launched
  ~01:52, ~65 min): the hazard dose-response, `damageRatio` 0.05/0.15/
  0.30, everything else fixed. Monotone harm rising with damage makes the
  chain above causal rather than merely consistent.
- **Cycle k5 READY**: `bash $SP/continuous/run-cycle5.sh`. The
  potion-VALUE sweep — `effectTurns` 3/8/20, hazards off, the working
  flag on. **This is the live head of the queue**: it finds where
  collecting potions starts to pay, or shows that it never does.
- `$SP/experiment-queue.md` is current and reprioritized with reasons.
- `$SP/continuous/pc-batch-next.md` is **current**: 7.8 h in three slots
  (C sizes A, A finishes P11 to a decidable read, B is the potion-value
  sweep at the owner's shape), with the corrected reading rule and the
  scaling check written in.

## Two operational warnings

- **Check for a running pair before launching anything.** Two `run-pair`
  processes collided once (a detached shell from an earlier turn started
  a duplicate ladder and rebuilt the same bundle underneath it). Wall
  clock barely moves under contention because the games are wall-clock
  bounded — the damage shows up only as less search per decision, which
  is the quantity being measured. Use
  `ps -eo pcpu,etime,args --sort=-pcpu --no-headers | head -6`.
- **The box is shared with sibling agent threads** that run test suites at
  will (loadavg ran 8-16 throughout). Contention is symmetric across arms
  so it widens floors without biasing readings, but it makes any
  concurrency comparison meaningless and it is why cross-cycle pooling
  buys less power than block counts suggest.

## The one thing a successor should not repeat

Do not buy more blocks for item 1's SMASH question. It is answered. The
productive direction is the value sweep (k5) and, if that never crosses
zero, telling the owner plainly that invulnerability potions are not
worth chasing in this game at any setting the harness offers — and
leaving the ordering flag selectable, default OFF on hazard boards.
