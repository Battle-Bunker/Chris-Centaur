# CONTINUOUS RUNNER — STATE

**RESUMED 2026-09-01 ~02:52.** Cycle 5 (k5, the potion-VALUE sweep) is
running as cycle 5b — see §6. Exact resume instructions if paused again:
`$SP/continuous/SUCCESSOR.md`.

## 6. Resumption note (2026-09-01 ~02:52)

- `origin/claude/cluster-lookahead` advanced to `79b5f5e` (the toll fix:
  "the first-plan gate states its tail as a RATIO, so a shared box cannot
  fail it") after this runner paused. Confirmed `79b5f5e` is a strict
  descendant of local `tmp/potionplay` HEAD (`ecf5609`) — cluster-lookahead
  now contains all of the potion-intel work AND the toll fix, so bundles
  are built from `79b5f5e` directly rather than from `tmp/potionplay`.
- New bundle **`$SP/ppruns/b5`** built from `79b5f5e` (`build-bot.sh
  79b5f5e $SP/ppruns/b5 --force`, shared npm install, 6 pre-existing tsc
  errors as expected). `run-cycle5b.sh` supersedes `run-cycle5.sh` (same
  spec, `b5` instead of `b4`).
- On resume, TWO sibling `run-sweep.js` pairs (`piruns/a3`, `piruns/l1`,
  `--workers 1` each, 4 processes on the 4-core box) were already live —
  another agent thread's acceptance-game work, per STATE's standing box
  note. `run-cycle5b.sh` **waits** (`pgrep -f 'run-sweep\.js|run-pair\.js'`,
  30s poll) for the box to clear before launching k5's `run-pair.js`, so
  it does not stack a third pair on top.
- **Correction on launch mechanism.** First attempt used a tracked Bash
  `run_in_background` job — but that job's `timeout_ms` ceiling (max
  600000 = 10 min) applies EVEN IN BACKGROUND MODE, and the box-clear wait
  ran past it: the job was silently `killed` by the tool at 10 minutes,
  still inside the `pgrep` wait loop, no sweep games run. Confirmed no
  orphaned child survived the kill (clean). Relaunched as detached
  `nohup … & disown` (pid recorded in `$SP/continuous/k5.pid`) — the
  pattern this file's §0 flags as a hazard, but the only one that survives
  a wait longer than 10 minutes. Trade-off: no automatic completion
  notice, so this session polls periodically instead (see below) rather
  than assuming the tool will wake it. **A successor: check
  `$SP/continuous/k5.pid` against `ps` before assuming a fresh detached
  shell is safe to ignore — this one is expected and is not the
  duplicate-run-pair hazard from §0, it's the mechanism now standard for
  any cycle expected to run past 10 minutes.**
- Second sibling pair rotation observed while waiting: `piruns/a3`+`l1`
  finished and were replaced by `piruns/l3`+`l4` (still 4 processes,
  4/4 cores). The box has not had an idle moment yet this session — the
  wait loop just keeps polling every 30s.

## 7. k5 landed — cycle 5 result (2026-09-01 ~03:55)

432 games, 216/arm, 0 failed. **Merged `claude/kit-depth-miner-fix`
(639416b, fast-forward) into `$SP/ppkit` first** — `depth-ran.js` existed
nowhere in the kit before this; do not use it on data from before this
merge.

**Verdict: NULL AT ALL THREE effectTurns SETTINGS. Queue item 9 CLOSED.**

| cell (effectTurns) | G = potionOrder−plain, 24 blocks | 95% CI | potions/game potionOrder vs plain |
|---|---:|---:|---|
| 3 | +0.054 | [-0.053, 0.165] | 4.06 vs 2.69 (+51%) |
| 8 | +0.049 | [-0.149, 0.264] | 3.86 vs 2.73 (+41%) |
| 20 | +0.047 | [-0.238, 0.325] | 3.11 vs 2.40 (+30%) |

Every CI contains zero at every setting; the point estimate does not rise
with effectTurns despite potions being visibly worth more to hold (30-51%
more collected each time, monotone with the ordering flag doing its job).
Hazard occupancy is 0 as designed (hazards off), so this isolates the
prize question cleanly from the hazard-chase harm found in k1/k2.
**Standing verdict for the programme: invulnerability potions are not
worth chasing in this game at any effectTurns the harness offers.**
`potionOrdering` stays selectable, default OFF on hazard boards (per k1/k2's
-0.145 replicated harm there). No replication needed — nothing crossed
zero to replicate.

## 8. Cycle 4 RERUN as 4b, in flight

Box was clear (0 sibling processes) right after k5 landed — launched
immediately. `run-cycle4b.sh` uses **bundle `b5`** (not `b4` — same
toll-fix rebuild as k5) and reruns the hazard dose-response
(damageRatio 0.05/0.15/0.30) that k4 aborted at 90/216 games/arm.
Detached (`nohup`), pid in `$SP/continuous/k4.pid`, log
`$SP/continuous/k4.log`, `$SP/continuous/k4` cleared and rebuilt from the
same deterministic spec (same seeds as the aborted attempt).

**Deferred, on purpose:** `replaymech.js` on k2/k3 (queue item 3 above)
waits until k4b finishes — it's single-threaded but not free, and k4b is
using all 4 cores at `--workers 2`. Do not run it concurrently.

## 9. k4b landed (2026-09-01, after 2 container-recycle deaths + 2 resumes)

212/216 games per arm (4 permanently FAILed: same seed, both arms,
duplicate-replay-refused from the first crash's partial writes — pairing
stays symmetric). The 4 corresponding corrupt `.jsonl.gz` orphans (8
files, both arms) were deleted so `replaymech.js` could run; they were
never in the manifest.

**FINDING: THE k1/k2 HAZARD-HARM RESULT DOES NOT REPLICATE ON b5
(post-toll-fix). Likely explanation: the toll fix itself, not noise.**

| damage | G = potionOrder−plain, 24 blocks | 95% CI | hazard occ. potionOrder vs plain | deaths/game |
|---|---:|:--|---|---|
| 0.05 | +0.032 | [-0.110, 0.183] | 1.39 vs 1.40 (same) | 2.25 vs 2.43 |
| 0.15 | +0.015 | [-0.111, 0.134] | 1.05 vs 1.10 (same) | 2.35 vs 2.45 |
| 0.30 | **+0.178** | **[0.021, 0.338]** | 0.89 vs 0.97 (same) | 2.44 vs **2.91** |

k1+k2 (bundle `b4`, pre-toll-fix) found -0.145 [-0.258,-0.035] at damage
0.15, replicated twice, with the mechanism fully traced: potionOrder
walked units into hazard MORE (occupancy/head-entries elevated vs plain).
**On b5, hazard occupancy and head-entries into hazard are statistically
identical between potionOrder and plain at every dose** — the walking-into-
hazard mechanism that explained the old harm is gone. At the highest dose
the direction reverses: potionOrder now has FEWER deaths/game than plain
(2.44 vs 2.91) and G's CI excludes zero on the positive side, though
barely (lower bound 0.021, and this cell's own A/A floor is 0.277 — wide,
per the corrected rule that's not disqualifying, but it means this single
reading alone should not be over-claimed; the CLEAN NULL at 0.05/0.15 is
the more load-bearing part of this finding).

**This changes the standing recommendation from k1/k2.** The "default OFF
on hazard boards" guidance was conditioned on the pre-toll-fix bundle. On
the current tip (`79b5f5e`) there is no evidence of harm and weak evidence
of a small benefit at high hazard damage. **Do not restate the old -0.145
harm number without the bundle caveat — it was measured on `b4`,
superseded by the toll fix.** A full k1/k2-style replication on `b5` (not
just this dose-response cell) would be needed to positively confirm no
harm at the original hazard-snake6 cell; this cell (interior-hazard
snake6 at 3 doses) is the same board family but not literally the same
cell k1/k2 used. Flag for the owner: the toll fix's scope may be broader
than "first-plan gate" — worth a direct question to whoever landed
`79b5f5e` about what else it touches.

## 10. replaymech.js on k2 and k3 (zero games, independent confirmation)

Both confirm the collecting capability generalizes with no harm signal;
nothing new, folds into item 1's existing finding.

| batch | cell | plain potions/game | potionOrder potions/game | deaths/game (plain vs potionOrder) |
|---|---|---:|---:|---|
| k2 | potion-hazard-snake6 | 1.71 | 2.24 (+31%) | 3.84 vs 4.02 |
| k2 | potion-snake6 | 1.16 | 1.95 (+68%) | 4.63 vs 4.66 |
| k3 | potion-snake5-knight | 0.40 | 1.13 (+183%) | 4.19 vs 4.17 |

k2's hazard cell here (pre-toll-fix bundle) still shows deaths ticking up
slightly for potionOrder (4.02 vs 3.84) — mild, consistent with the old
b4-era harm direction; not re-litigated since b5's k4b already supersedes
the quantitative claim on that mechanism.

## 11. Queue item 4 — evaluator-selection ladder (R1) — SCOPE BLOCKER FOUND

Started building the ladder from `overnight/batch3-roster.md` R1: within-
game `[lobster-territory, lobster-material, reflex]`, self-flooring
identical arms, 6 roster cells x 32 blocks at OWNER SHAPE
(`cells.js` DEFAULTS: 2000ms/25x25/turnCap120/3x6 — 15x the budget-ms and
~1.5x the turns of every potion cell run so far).

Added `snake5-rook` / `queen2-snake4` rosters to `cells.js` (two of R1's
six cells didn't exist yet). Wrote `specs/mkroster.js`, chunked one cell
per invocation on purpose. **Names deliberately avoid the bare roster
name** — `snake5-knight`/`snake5-queen` are in `cells.js`'s
`LEGACY_POTIONS_OFF` set and R1 needs potions ON, so the cell name is
`potion-ladder-<roster>` instead (dodges the guard cleanly, no `cells.js`
override needed for that part).

**TIMING SMOKE TEST (1 game, `--workers 1`, uncontended box): 470.8s —
7.85 minutes PER GAME at owner shape.** That is ~12x a potion cell's ~38s.
R1's own design is 32 blocks x 3 rotations x 2 arms = 192 games for ONE
cell; at 4-way concurrency (`--workers 2`, both arms) throughput will be
worse than the uncontended single-game number, call it conservatively
~13 games/hour/arm → **~7+ HOURS WALL CLOCK PER CELL**, and this queue
item has SIX cells (~1,152 games total, potentially 40+ hours). Given
this session's established constraint — **live-game batches must be
foreground-babysat, they do not survive as detached background jobs
across idle gaps** — a 7-hour cell means ~40+ foreground sleep/tail
check-ins for ONE cell alone, before any of the other five.

**Decision taken (chunked, per the queue item's own instruction, auto-mode
default rather than blocking on it): running the FIRST cell (`snake6`,
the null roster — cheapest to interpret, everything nulls here by
construction) at a REDUCED 8 blocks (24 games/arm, 48 total) instead of
R1's 32, to get a first real reading and a real floor at this shape
before committing more hours.**

**LANDED. 48 games, 0 failed, 5529s (~92 min) at `--workers 2`,
confirmed 16 games/hour/arm** — matches the smoke test almost exactly,
so THE THROUGHPUT ESTIMATE ABOVE IS NOW MEASURED, NOT GUESSED: ~1.5hr for
8 blocks on one cell, ~6hr for R1's own 32.

**Reading — clean and enormous, resolves at only 8 blocks:**

| contrast | G, 8 blocks | 95% CI | clears own floor? |
|---|---:|:--|---|
| territory − material | **+1.620** | [1.467, 1.800] | yes, easily (own floor 0.428) |
| territory − reflex | **+1.691** | [1.488, 1.916] | yes, easily |

Matches the overnight preview's direction and roughly its magnitude
(+1.39 there) on the all-snake control cell — territory dominates
completely with no pieces on board, as expected; this cell is the
sanity-check rung, not the open question. **8 blocks is already far more
than this cell needs** (CI half-width 0.17-0.21 against an effect over
1.6) — the piece cells are where the overnight preview found the
advantage shrinking toward zero and are the ones actually worth the next
~1.5hr chunk each.

**APPROVED by coordinator: run the 8-block first pass on all 5 remaining
cells, in order of expected information (where overnight already showed
territory's advantage shrinking/reversing, biggest deviation from the
all-snake +1.39 baseline first) — so a cut-short run keeps the
highest-value verdicts. Order, from `overnight/findings-3-roster-ladder.md`
(a smaller/cheaper shape, 15x15/250ms — not directly comparable in floor
size, but the ranking signal is what matters):**

| rank | cell | overnight G (territory-material) | deviation from +1.39 baseline |
|---:|---|---:|---:|
| 1 | queen2-snake4 | **-0.465** (only outright reversal, doesn't clear its own floor there) | 1.855 |
| 2 | snake5-knight | -0.058 ("the decisive row" per finding-3) | 1.448 |
| 3 | snake5-queen | +0.018 | 1.372 |
| 4 | snake5-rook | +0.134 (retains the most advantage of the four) | 1.256 |
| 5 | mix-king | no overnight number (new cell for R1) — runs last, no prior signal to rank it by | — |

After this pass: rank rungs by CI-width-vs-effect and PROPOSE (do not
launch) which if any deserve the extra 24 blocks — quota is at 94%,
extra blocks need a case, per the coordinator.

(Resolved — the coordinator approved the 8-block-first-pass plan above;
this superseded paragraph is left deleted rather than renumbered.)

A successor reads this file top to bottom and can resume cold.
Predecessor method: `$SP/overnight/STATE.md` (cycles c1..c6,
findings-1..7). This file supersedes it for the continuous programme.

`SP=/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad`

## 0. Box facts (verified 2026-08-31 23:19)

- 4 cores, 15 GB RAM, node v22.22.2, 22 GB disk free.
- **No Agent/Task subagent tool in this session** (same as the overnight
  runner found). Digest logs with small node/python scripts instead.
- ONE experiment pair at a time. `run-pair.js` launches both arms
  concurrently; the potion runs use `--workers 2`, i.e. 4 concurrent games
  on 4 cores. Do NOT start a second pair, and do not build a bundle while a
  pair is running — every cell here is `budgetMs`-bounded, so CPU
  contention changes how much search each decision buys.

- **CHECK FOR A RUNNING PAIR BEFORE LAUNCHING ANYTHING. This has already
  bitten once.** At 23:37 two `run-pair` processes were live at the same
  time — mine, and a duplicate launched by a detached one-shot background
  shell left over from an earlier turn of this session (it built the same
  bundle `b4` into the same directory and started `ppruns/c3`, the same
  channel ladder on a subset of the same seeds). Eight match-workers on
  four cores, and two concurrent writers to one bundle. Both runs were
  killed, `b4` was rebuilt with `--force`, and cycle 1 was restarted from
  scratch; `ppruns/c3` was removed. Wall clock per game barely moved under
  the contention (37-39 s either way) because these games are wall-clock
  bounded — **the damage does not show up in the log, it shows up as less
  search per decision**, which is precisely the quantity the experiment is
  measuring. So the check has to be explicit:

  ```
  ps -eo pcpu,etime,args --sort=-pcpu --no-headers | head -6
  ```

  Look for `match-worker.js`, `run-sweep.js`, `run-pair.js` and any `jest`
  before you launch. Detached shells from earlier turns have PPID 1 and do
  not appear as children of the agent process.

- **THE BOX IS SHARED, AND THAT IS NOT FIXABLE BY THIS RUNNER.** Minutes
  after cycle 1 restarted, a sibling thread of this same session began a
  full `jest` suite in `$SP/pi` — three more worker processes on the same
  four cores. That is another agent doing its own legitimate work, and a
  measurement runner does not get to kill it. Consequences to design
  around, not to complain about:
  1. An uncontended box cannot be assumed at any instant, so **the
     `--workers 1` vs `--workers 2` floor comparison in cycle 2 is
     confounded by whatever the sibling happens to be doing.** Run it
     anyway — it is still the cheapest evidence available — but quote the
     contention, and prefer replication over a single comparison.
  2. Contention is SYMMETRIC across the two arms (both are running
     throughout), so it inflates the A/A floor without biasing the
     reading. A wider floor is honest; a biased one would not be.
  3. Keep the audit: `armservice.js` and `armdrift.js` read plans per
     decision per game, so a contaminated window is identifiable after the
     fact rather than invisible. Report it; exclude blocks only with the
     exclusion stated.
- Throughput measured on the live potion cells (21x21, 200 ms, cap 80,
  `--workers 2`): **~190 games/hour PER ARM**, both arms concurrent. A
  72-game-per-arm pair is ~23 min. Budget ~60-90 min per cycle = one
  144-216 game/arm pair, or two smaller ones.

## 1. Repo / branch map (fetched 2026-08-31 23:19)

| ref | SHA | what |
|---|---|---|
| `origin/claude/mid-turn-collision-logic-mkxurg` | `66904d2` | validated baseline; NO `bot-config.ts` (defaults-only arms) |
| `origin/claude/cluster-lookahead` | `06ddd05` | search-architecture branch (P11's subject) |
| `origin/sim/worker-kit` | `17183e9` | the kit |
| `origin/sim-results/local-20260831` | `78c151d` | batch-2 results as delivered |
| **local** `tmp/potionplay` (`$SP/pp`) | `7f89a74` | THE POTION-INTEL BUILDER'S BRANCH — local only |
| **local** `feature/potion-intel` (`$SP/pi`) | `06ddd05` | branch point only, NO commits yet |

**`feature/potion-intel` is NOT on origin and has no commits.** Queue item 1
says to add its acceptance-game item when it appears there. The equivalent
work is nevertheless live: the builder is iterating on local
`tmp/potionplay`, and the acceptance games run against bundles built from
its commits. Re-check `git ls-remote origin | grep potion` each cycle.

`tmp/potionplay` commits, oldest first:
`83c486e` slate+enumeration+multistart · `a7795f6` advisory lands where ·
`35695de` caller's evaluator is the slate BASE · `df36527` cheap cell scan,
bold slate, cached lineup identity · `7f89a74` **the pickup ordering slot,
`candidates.potionOrdering`**.

## 2. Harness cheat sheet

```
cd $SP/ppkit                                   # kit worktree, 6ffb5aa
KIT=$SP/ppkit node $SP/ppruns/mkorder.js <blocks> <budgetMs> <size> <turnCap> <out.json>
node tools/simworker/bin/run-pair.js \
  --batch <dir> --spec <spec.json> \
  --arm nullA=<bundle> --arm nullB=<bundle> --workers 2 --note "..."
node $SP/ppruns/within.js <batchdir> <botX> <botY>   # within-game G + A/A floor
node $SP/ppruns/mech.js  <batchdir>                  # engine mechanism table
tools/simworker/build-bot.sh <ref> <dir> --force     # build a bundle
```

Bundles: `$SP/ppruns/b0..b3` ← the four potionplay commits above;
`$SP/overnight/bundles/{baseline,feature}` ← `66904d2` / `c74f0a1`.

**The measurement design in use (both-sides-one-game).** Three contenders
are seated in ONE game with `rotateSeats:true`, so the contrast
G = sharePar(X) − sharePar(Y) is within-game and needs no arm pairing. The
two arms `nullA`/`nullB` are IDENTICAL, so the between-arm difference of G
is that cell's A/A floor. One pair therefore buys the treatment reading and
its own floor at the same time. Blocks accumulate across cycles because
each cycle draws a fresh seed range.

## 2b. The tools this runner added — all in `$SP/continuous/`

| tool | usage | why it exists |
|---|---|---|
| `accum.js` | `<subj> <ctrl> <batch>...` | within-game G pooled across ANY number of batches, plus the A/A floor. The predecessor `within.js` concatenated the two arms' block means and bootstrapped 2n values as independent — they are paired on the same seed, so its intervals are too narrow, in the direction that makes a marginal result look decided. `accum.js` averages the arms inside a block first, and REFUSES a seed that appears in two batches, which is what makes cross-cycle pooling safe. |
| `floorscale.js` | `<subj> <ctrl> <batch>...` | the A/A floor on nested prefixes of the same run's blocks, against the 1/sqrt(n) prediction. **Run this before promising power for any cell.** |
| `armservice.js` | `<batch>...` | plans/decision for the same bot across the two identical arms — detects unequal CPU service |
| `armdrift.js` | `<batch> [bucket]` | the same gap by position in the run — separates warmup from a steady bias |
| `replaymech.js` | `<batch>...` | reads the gzipped replays: per bot, potions collected, hazard occupancy, head entries into hazard, health per unit, deaths per game — all paired within game. **This is the tool that produced the session's best result, at zero machine cost.** Point it at any batch. |
| `specs/mkchannel.js` | `<blocks> <budget> <size> <cap> <seedBase> <out>` | the channel ladder (plain / potionOrder / potionBoth), two snake cells |
| `specs/mkknight.js` | same args | one knight cell, many blocks — the piece-cell floor |
| `specs/mkdose.js` | same args | the hazard dose-response, damage 0.05/0.15/0.30 |
| `specs/mkpotval.js` | same args | the potion-VALUE sweep, effectTurns 3/8/20, hazards off |
| `run-cycle{1..5}.sh` | — | one command per cycle; each is self-contained and names its own purpose |

**Spec-writing gotchas already paid for.** The cell vocabulary
(`$SP/ppkit/tools/learnloop/lib/cells.js`) has no damage or effectTurns
axis, so those are set by overwriting `c.config.hazards` /
`c.config.potions` after `cells.cell(...)` and putting the dose in the
cell NAME — one name, one board. The kit REFUSES `damageRatio` 0 with
layout `cross` ("hazard cells that do nothing"); use a small nonzero dose.
`seedsFor(id, blocks, seedBase)` derives an arithmetic run from the id, so
a LARGER block count NESTS the smaller one — to get disjoint seeds for a
replication, change `seedBase`, not the count.

## 3. Cycles run, and what each returned

| cycle | batch | games | what it was | result |
|---|---|---:|---|---|
| c1 | `$SP/ppruns/c1` | 144 | potionAware vs plain (+reflex) | every G negative; the advisory costs 28-44% of plans/decision |
| c2 | `$SP/ppruns/c2` | 144 | the WEIGHT ladder, plain/aware/bold | the ladder does not rise; bold <= aware on all three cells |
| k1 | `$SP/continuous/k1` | 288 | the CHANNEL ladder, plain/potionOrder/potionBoth, 24 blocks | free channel does not earn; -0.146 on the hazard cell |
| k2 | `$SP/continuous/k2` | 288 | k1 replicated on disjoint seeds | **-0.143 — replication**; pooled -0.145 [-0.258, -0.035] |
| k3 | `$SP/continuous/k3` | 288 | the PIECE-CELL FLOOR, 48 blocks, one knight cell | **floor is SOUND**; "piece cells have no floor" withdrawn |
| k4 | `$SP/continuous/k4` | 178 | hazard DOSE-RESPONSE, damage 0.05/0.15/0.30 | **ABORTED at 90/216 per arm** (quota directive). Low rung complete: -0.030 at damage 0.05 vs -0.145 at 0.15. Two points, overlapping — not a curve. The 0.30 rung never ran. |
| — | replays, zero games | 288 read | `replaymech.js` on k1 | **the capability works: +22-45% potions collected** |

**1,330 live games + 288 replays read.**

### The three results that matter

1. **The potion-collecting capability is built, free, and demonstrated in
   play.** `candidates.potionOrdering` collects 22% more potions on the
   hazard cell and 45% more on the plain one than the byte-identical bot
   without it, in the same games, while evaluating 1.7-3.7% MORE plans
   per decision. **It still does not smash — because the prize is small.**
   45% more potions buys +0.021 [-0.143, 0.213] sharePar. That is a
   finding about the game, not about the bot. Full chain, tables and
   caveats: `$SP/continuous/item1-potion-ladder/results.md`.
2. **"Piece cells have no usable floor" is WITHDRAWN.** The knight cell's
   A/A floor at 48 blocks is -0.176 [-0.364, 0.018] — contains zero — and
   scales as 1/sqrt(n) to within 9% from 12 blocks up. The three earlier
   "broken floor" sightings share a block count of 8, not a piece board.
   `$SP/continuous/item3-piece-floor/results.md`.
3. **Two measurement rules were wrong and are corrected.**
   - "An effect must exceed the A/A floor" compares the spread of the
     DIFFERENCE of two arms against a reading that is their AVERAGE, so
     the floor is ~2x the reading's own half-width at any sample size
     (measured 2.63 / 1.96 vs a theoretical 2.00). It suppressed a real
     replicated result for a full cycle. Use the A/A null for BIAS, the
     reading's own interval for effect size, replication for confidence.
   - Block targets assumed 1/sqrt(n) scaling that does not always hold,
     and a floor from one 24-block run varies by ~2x between cycles with
     the box's load. Size each cell from its own `floorscale.js` curve.

## 4. Queue position and the cycle plan

Item 1's SMASH question is ANSWERED (no, and we know why). Item 3 is
CLOSED. The queue's live head is now the potion-VALUE question.

- **cycle 4 (k4) — ABORTED, RERUN IT** (`rm -rf $SP/continuous/k4` first;
  the spec is deterministic and will reproduce the same seeds).
  216 games/arm, ~68 min. The hazard dose-response: the same cell at
  `damageRatio` 0.05 / 0.15 / 0.30, everything else fixed. Monotone harm
  rising with damage confirms the measured chain is causal; a flat
  profile kills it. (The kit REFUSES `damageRatio` 0 with layout `cross`
  — "hazard cells that do nothing" — so the low rung is 0.05.)
  When it lands: `accum.js potionOrder plain $SP/continuous/k4`, then
  `replaymech.js $SP/continuous/k4` for the per-dose hazard occupancy and
  death counts.
- **cycle 5 (k5) — READY TO FIRE, AND IT GOES FIRST**, `bash $SP/continuous/run-cycle5.sh`,
  216 games/arm, ~68 min. **The potion-value sweep** — `effectTurns`
  3 / 8 / 20, hazards OFF, the working `potionOrdering` flag on,
  `potionOrder` vs `plain` vs `reflex`. Finds where collecting potions
  starts to pay, or shows that it never does. Spec generator written and
  validated (`specs/mkpotval.js`); seeds 102301+.
- **cycle 6+** — follow k5. If the curve crosses zero, replicate that
  cell on disjoint seeds before claiming it (replication is the standard
  now, not block count). If it never crosses, write the verdict and move
  to queue item 4.

## 5. Standing constraints

- Never push to a code branch; never modify `src/`. Results live in
  `$SP/continuous/`.
- Every claim quotes its own floor in its own units. No floor, no claim.
- Vocabulary: in-collection / selectable / validated / merged. Never
  "dark", never "promote".
- `$SP/continuous/pc-batch-next.md` is kept current at all times.

## 12. R1 cell 2/6 (queen2-snake4) — landed; runner lost to spend limit

Runner agent 429'd (account monthly spend limit; weekly reset Sep 2
14:00 UTC) halfway through this cell. Coordinator finished it in-session:
relaunched with `--resume` (2 games/arm permanently FAILed as duplicate
replays from the kill — symmetric, pairing intact), babysat via the
Monitor tool, which — measured, not guessed — KEEPS THE CONTAINER WARM
across the wait: the games ran to completion under an armed Monitor with
no agent turn active. That replaces the foreground-sleep babysit as the
cheapest procedure.

**Reading (22 games/arm, 8 blocks):** territory − material G = **+0.179**,
95% CI [-0.273, 0.724], own A/A floor 0.732 — does NOT clear its floor,
UNDECIDED at 8 blocks. But the overnight's outright reversal (-0.465 at
15x15/250ms) does not replicate at owner shape: the point estimate is
positive. Same theme as k4b — pre-toll-fix/small-shape readings keep
dissolving on the current bundle. No reflex seat in this roster, so only
the one contrast.

Cell 3/6 (snake5-knight, rank 2, "the decisive row") launched at 8 blocks,
seeds 60301-60308, batch `rl3`, Monitor-babysat. Remaining after it:
snake5-queen, snake5-rook, mix-king.

## 13. R1 cell 3/6 (snake5-knight, "the decisive row") — LANDED, and it decides

24 games/arm, 0 failed, ~1.6h Monitor-babysat. **Territory's snake-only
dominance collapses to zero the moment one knight is fielded:**

| contrast | G, 8 blocks | 95% CI | floor | clears? |
|---|---:|:--|---:|---|
| territory − material | +0.060 | [-0.209, 0.336] | 0.232 | no |
| territory − reflex | -0.074 | [-0.297, 0.133] | 0.309 | no |

The residual sign is undecided, but the COLLAPSE is decided: both CIs
exclude anything remotely like the +1.6 all-snake effect. This confirms
the overnight shrink-to-zero direction at owner shape (unlike the
queen2-snake4 reversal, which did not replicate). Cell 4/6
(snake5-queen, batch rl4, seeds 60401-60408) launched, Monitor-babysat.

## 14. R1 cell 4/6 (snake5-queen) — territory HOLDS with a queen fielded

24 games/arm Monitor-babysat. territory − material G = **+0.536**
[0.267, 0.829], floor 0.463 — marginal clear, clearly positive.
territory − reflex G = **+1.682** [1.553, 1.811], floor 0.270 — decisive.

So the piece-collapse is NOT "any piece": a knight zeroes territory's
edge (cell 3), a queen leaves most of it intact. Working hypothesis for
the value lens: leaper mobility punches through territorial structure in
a way slider mobility does not (a queen's rays are themselves
territorial; a knight's jumps ignore the territory metric entirely).
Cell 5/6 (snake5-rook, batch rl5, seeds 60501-60508) launched — the rook
discriminates: pure slider, less coverage than queen.
