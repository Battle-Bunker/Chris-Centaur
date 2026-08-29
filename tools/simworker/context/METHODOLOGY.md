# METHODOLOGY — the laws, and what each one cost to learn

You have never seen this program. These are not style preferences. Every one of
them is a rule the program adopted after a measurement went wrong in a way that
was not obvious at the time, and each is stated here with the exhibit that
forced it, so you can tell when it applies and when it does not.

The short version, in the order they bite:

1. Two contenders on two branches cannot share a game. Arms are processes.
2. Every batch carries a null cell, sized like its treatment cells.
3. Mechanism before placement. Placement is the blunt instrument.
4. Wall-clock is part of the experiment. One arm pair at a time.
5. Some counters are retired. Do not revive them.
6. Anything measurable without a race should be measured without a race.
7. Record SHAs. Branch names are not provenance.

---

## §1. An arm is a process, not a seat

A node process holds exactly one copy of `src/lobster/*`. Whichever build it
loaded is the build every seat plays. So two contenders that live on different
branches — `integrated` and `perf-substrate`, say — cannot be seated in the same
game at all. There is no flag for it and no clever seating that gets around it.

Cross-branch comparison is therefore cross-PROCESS: build both
(`build-bot.sh`), run both at once (`run-pair.js`), pair afterwards by gameId.
The whole shape of this kit follows from that one fact.

Two consequences worth internalising:

- **The gameId is the pairing key.** `<cell>-s<seed>-r<rotation>`. It does not
  encode bot names, so two arms with the same spec produce the same gameIds and
  pair exactly. `aggregate.js` still checks configHash and seat assignment game
  for game before it will pair them, because "the same spec" is a claim and
  claims get checked.

- **The opponent field is only approximately held fixed.** In a cross-branch
  pair the field (`lobster-material`, `reflex`) is compiled from each branch
  too. It is the same field to the extent the branches did not change those
  paths — an assumption, not a guarantee. The null cell is what catches it if
  they did.

A same-build comparison (an env flag, or a profile behind
`TeamDecisionOptions.evaluate`) *could* be seated in one game. Run it as a pair
anyway. One analysis path, one set of habits, and the null cell means the same
thing in both.

---

## §2. The null cell is mandatory, and it is sized like the treatment

**A batch without a concurrent null cell produces no claimable numbers.** Not
weak numbers — unreadable ones. Without a null, "score +0.08" could be a real
effect or could be less than this box's run-to-run variance, and nothing in the
number itself says which.

The program did not adopt this from theory. It adopted it after nulls kept
coming back significant:

- **I4's null.** On a *provably inert* path — a code path the treatment cannot
  reach — at four blocks per cell, outcome confidence intervals EXCLUDED ZERO.
  The law was broadcast to every agent in the program from that single result:
  *feature-off null cell, run concurrently, is mandatory; only structurally
  null-safe direct metrics are trustworthy at small n.*

- **I6's orphan single-game null.** Two BYTE-IDENTICAL bots, one game, reported
  a burn delta of −100.0/game and a placement delta of −0.500, with degenerate
  intervals excluding zero. It is the cleanest illustration in the corpus of
  why small-n outcome claims without null controls are worthless.

- **I1's retracted 1000 ms arm.** Its null — two byte-identical arms — reported
  selfInflicted −1.250 [−1.333, −1.083], allDeaths −0.833 [−1.167, −0.667],
  score +0.208 [+0.042, +0.417], material +4.000 [+2.583, +5.250]. The
  *treatment* sat INSIDE the null on placement, deaths and material. The whole
  arm was retracted. Cause: three concurrent 1000 ms wall-clock searchers on
  four cores do not get equal service.

There are two kinds of null and you want both when you can get them.

**A/A null** — the same bundle, the same env, two arm names:

```
--arm nullA=<bundle> --arm nullB=<bundle>
```

Then prove it really was A/A, and read off the floor it measured:

```
node tools/simworker/bin/verify-null.js --batch <dir> --null nullA,nullB
```

**Provably-inert cell** — a cell where the treatment cannot act by
construction. `snake6` is the one this kit ships: I2's slider profile adds terms
gated on piece class, so with no piece on the board the two evaluators are
bit-identical (asserted in `src/tests/territory-slider.test.ts`). The staging
guard's regression is likewise a snake-only phenomenon. This null is stronger
than A/A because it rides inside the treatment batch instead of costing a
separate pair — same box, same load, same hour.

**Size the null like the treatment.** A 4-block null beside a 16-block treatment
understates the floor, because the floor narrows with block count. That is the
direction that makes a treatment look significant when it is not.

---

## §3. Mechanism metrics are primary; placement is the blunt instrument

**Placement resolution is roughly ±0.10 on the normalized score at 16 blocks.**
A delta smaller than that is not a small effect — it is no effect this design
can see. Chasing it costs nights and returns noise.

### §3.0. What the game actually scores, and what this harness scores

The authority is `TeamSnekProcessor.calculateWinners` in TacticToes, and it has
four branches, in this order:

1. **Every remaining team died on the same turn.** The outcome is settled from
   the PREVIOUS COMMITTED TURN's board: the team alive there wins if it is the
   only one, otherwise the highest total weight on that board wins, and an exact
   tie there is a draw.
2. **Exactly one team alive** — it wins outright, whatever its weight.
3. **Turn cap with two or more teams alive** — the highest total alive weight
   wins; an exact tie is a draw among the tied top teams.
4. Otherwise the game continues. (`maxTurns` is OPTIONAL in the game and
   MANDATORY here — a cap-heavy corpus is a property of this harness's regime,
   not a law of the game.)

Weight is occupied squares — a snake's length, a piece's stack size — and it
enters only through an argmax. A one-point lead pays exactly what a thirty-point
lead pays; a cap win pays exactly what wiping the board pays. Then
`processTurn.ts:144-174` scores every non-winning team 0, so **the winner(s)
place 1st and every loser ties 2nd.** The game has no graded reward for 2nd
versus 3rd, none for margin, and none for elimination order among losers.

Two consequences for how you read a table:

- **`score` is finer than the game's reward, and `pFirst` is the reward.**
  The harness's normalized placement pays a clean 2nd of 3 half a point. Nothing
  in the game does. `aggregate.js` reports `pFirst` — 1 for an outright or joint
  first, 0 otherwise — beside it for exactly this reason (`win` is the same
  number under its historical key). On a 2-team cell the two agree up to scale.
  On a 3-team cell they can disagree in sign, and when they do, the one that is
  about the game is `pFirst`. Report both; when they part, say so.
- **A mutual wipe is not a draw.** Branch 1 was mis-implemented here until
  2026-08-29: placements were read off the FINAL board, where every eliminated
  team carries zero material, so `all-eliminated` always scored a shared first
  and the "material breaks ties among teams that fell on the same turn" rule was
  vacuous exactly where it was meant to bite. `placementsOf` now adjudicates a
  mutual wipe on the previous committed turn's standings, which is the game's
  own rule: **a team ahead on weight that trades its last units for its rival's
  last units WINS.** Each placement row carries `adjudicatedMaterial` — the
  weight the placement was actually decided on, equal to `finalMaterial` on
  every other end kind — so a miner can always see which board settled it.
  Every other end kind is scored exactly as before.

  It is a rare branch. Across the 13,245 manifest rows in this program's corpus,
  `endKind: "all-eliminated"` occurs **10 times (0.076%; 0.21% of the 4,781
  decisive games)**, richest on `headline-mix-king` (4 in 2,928, 0.137%). Of the
  7 distinct games, re-adjudication turns **6 into a decisive result** and leaves
  1 a genuine tie on previous-turn weight. Correct the rule because it is the
  rule; do not expect it to move a placement column.

Mechanism metrics move first, move cleaner, and often move 5–25× outside the
null band where placement has not moved at all. I3 measured its ordering change
at 5–25× outside the null in every arm, cell and budget on mechanism, while
stating plainly that placement was NOT claimable at that n.

The mechanism rows `aggregate.js` reports, and what each one is for:

| metric | reads |
|---|---|
| `overrunRate` | decisions that missed the deadline — a budget the engine cannot honour |
| `unstagedRate` | units the bot spoke for but staged nothing on |
| `stagedNothingRate` | whole decisions that produced no move |
| `assumptionRate` | declared modelling narrowings — a degraded decision |
| `ratchetRate` | search slices refused for a weaker promise (tight-budget, not a fault) |
| `worstWallMs` | the worst decision this game — how close to the ceiling |
| `decisions` | how many decisions the game actually contained |
| `turns` / `decisive` | game shape; whether games END or run out |
| `illegal` / `errors` | **must be zero.** Nonzero invalidates the cell. |

The richest mechanism evidence is not in the manifest at all — it is in the
replays. Every turn row carries the full board, the resolved tiers, the staged
moves per unit, per-seat telemetry, and the turn's events (deaths with cause,
clashes, severed cells, promotions, eliminations). Mining that is where a
verdict gets its *reason* rather than just its sign.

**`terminal: "cap"` is a warning.** A cell where most games hit the turn cap is
measuring a stall, not play. `aggregate.js` prints the cap rate per arm and
flags a cell over 50%; treat those placement rows as uninterpretable.

---

## §4. Budget noise is part of the experiment

Every bot here is ANYTIME and WALL-CLOCK BOUNDED. How much it searches is a
function of how much CPU it got. A game on a quiet box and a game on a loaded
box were played by two different bots wearing the same name.

This is not a rounding error. I1's retracted arm (§2) is the exhibit: three
concurrent 1 s searchers on four cores did not get equal service, and the
resulting differences were the same size as the effects being chased.

The rules that follow:

- **One arm pair at a time.** Do not run three experiments concurrently to fill
  cores. Fill cores by giving each arm of ONE pair more workers.
- **Launch arms simultaneously.** `run-pair.js` does this and refuses a single
  arm. Sequential arms on this class of machine are not comparable.
- **Give both arms the same core budget.** Same `--workers`, always.
- **Record loadavg.** `run-pair.js` samples it every 30 s into the pair record,
  and run-sweep stamps it at start and end. Quote it in findings.md.
- **A resumed sweep straddles two load regimes.** `--resume` records the
  resumption in `spec.json` and `batch-manifest.js` flags it. Say so in
  findings.md; it is a real caveat, not bookkeeping.

**Legacy has its own budget floor.** `legacy`'s chunk dispatch is not
preemptible. Against a 150 ms deadline it overruns to ~1 s (measured worst
982 ms) and its own telemetry reports `statesEvaluated: 0`,
`chunksCompleted: 0`, `deadlineHit: true`. At 150 ms it is not playing badly —
it is playing its fallback move. **Give legacy arms ≥1000 ms, or read a 150 ms
legacy arm as a reflex baseline.** At the owner's 2000 ms this is comfortably
clear, which is what makes the 2000 ms re-baseline (P2) worth doing.

---

## §5. The retired counters

**`plansEvaluated` and `boundsInversions` are retired as signals.** They are
reported, marked retired, and must not carry a verdict.

The exhibit: I1's null cell reported `boundsInversions` of base 86 / null 8075 /
mine 1197 **on identical binaries**. A counter that varies by two orders of
magnitude between byte-identical builds is measuring the machine.

This kit reproduced the same class of thing in its own acceptance smoke: two
byte-identical arms, 2 games each, `plansEvaluated` delta −200 (levels 1948.5 vs
1748.5). Two games is nothing, which is the point — the noise is there
immediately and it is large.

They stay in the output because they diagnose a *broken* arm: an arm evaluating
zero plans is broken, and you want to see that. They are not evidence for a
verdict.

A note on what `boundsInversions` means when it does fire: the bounds layer
proved one of its own members inconsistent, the whole turn's search is refused,
and the decision falls back to its standing incumbent. It still stages a legal
move — the kernel refuses rather than clamping, so nothing unsound reaches the
wire — but that turn bought no search. Expect it late in a game, when wiping the
last opponent brings `WIN` (+Infinity) into the ceiling. It is counted
separately from `ratchetRefusals`, which are ordinary tight-budget refusals and
not a fault.

---

## §6. Same board, priced twice

**If a question can be answered without a race, answer it without a race.**

Comparing two arms compares two different sets of games: the bots diverge on
turn three and everything after that is a different board. That divergence noise
is the thing §2 and §4 are fighting. Some questions do not need to pay it.

The pattern, from I5's `offline-lift.js`, which is the technique this kit means
you to reuse:

> Take a real position out of a replay. Build the substrate the bot would have
> built. Fix ONE plan — the generator's first candidate, deterministic, the same
> plan in both configurations. Price it under configuration A and under
> configuration B, with an UNBOUNDED budget so the clock is not part of the
> comparison. Report the paired difference.

There is no run-to-run variance in that difference: same board, same plan, same
evaluator, same seed. Small-n mechanism claims survive §2's law this way and
essentially no other way.

Two companion techniques from the same family:

- **`argmax-probe`** — does the change reorder the DECISION, not just the
  score? Price the whole legal action set both ways and ask whether the argmax
  moved, and what the unconditional world says about the swap. A change that
  moves scores but never moves an argmax has changed nothing observable.
- **Static counterfactual** — replay recorded games and ask how many of the
  recorded events the change would have refused. I1 did this over 354 games:
  399/407 (98.0%) of territory's recorded self+wall deaths and 8/8
  self-regicides would have been refused. That is a strong claim from zero new
  games.

If you find yourself planning a 200-game sweep to answer "does this term change
the score", stop and ask whether the replays you already have can answer it on
fixed boards.

---

## §7. Record SHAs; branch names are not provenance

Branch tips move, including while you work. While this kit was being built,
`claude/cluster-lookahead` moved from `f4fcb41` to `8059b86` inside one hour.
A findings table that quotes a branch name and not a SHA is a claim nobody can
reproduce.

`build-bot.sh` resolves the ref to a SHA and builds the SHA, stamping
`bundle.json` with it. `run-pair.js` copies that stamp into every arm record and
`batch-manifest.js` lifts it into the batch manifest. **Every number you report
must be traceable to a SHA in that manifest.**

Corollary: if a branch you were told to build does not exist in the clone,
`build-bot.sh` fails and says so. **Do not substitute a branch that happens to
build.** Record the skip in findings.md.

---

## §8. Determinism, and what is actually reproducible

**The board is a pure function of the config.** Same config and seed, same
starting position, always. `configHash` is what `aggregate.js` checks.

**The games are NOT reproducible.** The bots are anytime and wall-clock bounded,
so under different load they search different amounts and choose different
moves. Replays are records of what happened, not recipes for repeating it.

Do not build any analysis that assumes rerunning a seed reproduces a game. Pair
by gameId across arms run *at the same time*; that is the only sense in which
two games here are "the same game".

---

## §9. Seat rotation and the block

Board geometry is not symmetric. On a three-team board the anchors are three
corners: two seats share a column, two share a row, one pair sits on the long
diagonal. A bot measured only in seat 0 is measured on one geometry.

Each seed plays a BLOCK of N games, cyclically rotating bots through seats:
`[A B C] [C A B] [B C A]`. This puts every bot in every seat once, *and* — the
part a plain "rotate the bots" argument misses — gives every unordered PAIR of
bots every seat-pair once. Neither seat advantage nor adjacency advantage
survives the block.

**The block, not the game, is the unit of resampling.** Treating games as
independent divides the standard error by roughly √N for free and manufactures
significance out of seat geometry. Every interval this kit computes is over
block means, with `n` = the number of seeds. Those intervals are wide on
purpose.

Block counts:

- **16 blocks minimum for a placement claim.** Below that, placement is
  descriptive at best.
- **4–8 blocks for mechanism-first exploration.** Enough to see a mechanism
  separation worth promoting to a full cell; never enough for placement.
- The seed sequences this kit generates NEST: a 16-block run contains the
  8-block run's seeds, so "we added blocks" is strictly stronger rather than a
  different experiment.

---

## §10. Honest write-ups

- **Every number with its null.** A treatment delta quoted without the null it
  was read against is not a finding.
- **A null result is a result.** Write it as one, with its interval. "No
  difference" and "we could not see a difference at this power" are different
  sentences; use the true one.
- **Say what you could not do.** A cell that crashed, an arm that exited
  non-zero, a batch that got resumed, a branch that would not build — all of it
  goes in findings.md. The record is more valuable complete than clean.
- **Never patch bot source to make a run work.** If a build fails on this
  machine, that IS the finding. Report it.
